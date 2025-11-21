// ============================================================================
// UNICREON – Core système "light"
// - Compétences : jet de dé simple (avec avantage / désavantage)
// - Objets : effets passifs (quand équipés) + effets actifs (à l’usage)
// ============================================================================

// ---------------------------------------------------------------------------
// FICHE DE COMPÉTENCE
// ---------------------------------------------------------------------------

class UnicreonCompetenceSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["unicreon", "sheet", "item", "competence"],
      width: 600,
      height: 500,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body" }]
    });
  }

  get template() {
    return `systems/${game.system.id}/templates/item/competence-sheet.hbs`;
  }

  getData(options = {}) {
    const data = super.getData(options);
    const item = data.item ?? data.document ?? this.item;

    data.item = item;
    data.system = item.system ?? item.data?.data ?? item.data?.system;

    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".competence-roll").on("click", async ev => {
      ev.preventDefault();

      const item = this.item;
      const actor = item.parent;
      if (!actor) {
        return ui.notifications.warn("Cette compétence doit être sur un acteur.");
      }

      const die = item.system.level || "d6"; // d4/d6/d8...
      const label = item.name;

      const mode = await Dialog.prompt({
        title: `Jet — ${label}`,
        content: `
          <form>
            <div class="form-group">
              <label>Mode :</label>
              <select name="mode">
                <option value="normal">Normal</option>
                <option value="adv">Avantage</option>
                <option value="disadv">Désavantage</option>
              </select>
            </div>
          </form>
        `,
        label: "Lancer",
        callback: html => html.find("[name='mode']").val()
      });

      if (!mode) return;

      const facesMatch = String(die).match(/(\d+)/);
      const faces = facesMatch ? facesMatch[1] : "6";

      let formula;
      if (mode === "adv") formula = `2d${faces}kh1`;
      else if (mode === "disadv") formula = `2d${faces}kl1`;
      else formula = `1d${faces}`;

      const roll = await (new Roll(formula)).roll({ async: true });

      roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: `<strong>${label}</strong> (${mode})`
      });
    });
  }
}

// ============================================================================
// PARSING DES TAGS D’EFFETS
// ============================================================================

// Effets passifs : appliqués tant que l’objet est coché "Équipé ?"
function parsePassiveTag(tag) {
  if (!tag) return null;

  // [puissance +1], [agilite -2], etc.
  const mCarac = tag.match(/\[(puissance|agilite|perception|volonte|pouvoir)\s*([+-]?\d+)\]/i);
  if (mCarac) {
    return {
      target: "carac",
      key: mCarac[1].toLowerCase(),
      value: Number(mCarac[2])
    };
  }

  // [pv.max +2], [pk.max -1]
  const mPool = tag.match(/\[(pv\.max|pk\.max)\s*([+-]?\d+)\]/i);
  if (mPool) {
    return {
      target: "pool",
      key: mPool[1].toLowerCase(),
      value: Number(mPool[2])
    };
  }

  return null;
}

// Effets actifs : utilisés par le bouton "Utiliser cet objet"
function parseEffectTag(tag) {
  if (!tag) return null;

  // [N PV] → soin/dégâts directs
  const mHeal = tag.match(/\[(\-?\d+)\s*PV\]/i);
  if (mHeal) return { type: "heal", pv: Number(mHeal[1]) };

  // [N PV / X] → soin sur la durée (info narrative)
  const mHealTime = tag.match(/\[(\-?\d+)\s*PV\s*\/\s*([^\]]+)\]/i);
  if (mHealTime) {
    return {
      type: "healOverTime",
      pv: Number(mHealTime[1]),
      time: mHealTime[2].trim()
    };
  }

  // [puissance 3], [agilite 2], etc. → test de carac
  const mStat = tag.match(/\[(puissance|agilite|perception|volonte|pouvoir)\s*(\d+)\]/i);
  if (mStat) {
    return {
      type: "statCheck",
      stat: mStat[1].toLowerCase(),
      diff: Number(mStat[2])
    };
  }

  // Sinon : simple note
  return { type: "note", raw: tag };
}

// ---------------------------------------------------------------------------
// APPLICATION DES EFFETS ACTIFS
// ---------------------------------------------------------------------------

async function applyEffect(actor, effect) {
  if (!effect) return "Aucun effet.";

  // --- SOIN / DÉGÂTS DIRECTS SUR LES PV -----------------------------------
  if (effect.type === "heal") {
    const sys = actor.system ?? {};
    const pools = sys.pools ?? {};
    const pv = pools.pv ?? {};

    // PV de base stockés dans le système
    let baseMax = Number(pv.max ?? 0);
    if (!Number.isFinite(baseMax) || baseMax < 0) baseMax = 0;

    let baseVal = Number(pv.value ?? 0);
    if (!Number.isFinite(baseVal)) baseVal = 0;
    if (baseVal < 0) baseVal = 0;
    if (baseVal > baseMax) baseVal = baseMax;

    // Bonus de PV max via effets / objets équipés
    const bonus = Number(sys.derived?.poolBonusValues?.["pv.max"] ?? 0) || 0;
    const effMax = baseMax + bonus;

    // PV effectifs actuels (ce que la fiche affiche)
    let effVal = baseVal + bonus;
    if (effVal < 0) effVal = 0;
    if (effVal > effMax) effVal = effMax;

    // On applique le soin / les dégâts sur les PV effectifs
    effVal += effect.pv;
    if (effVal < 0) effVal = 0;
    if (effVal > effMax) effVal = effMax;

    // On reconvertit en PV de base (stockés)
    let newBaseVal = effVal - bonus;
    if (!Number.isFinite(newBaseVal)) newBaseVal = 0;
    if (newBaseVal < 0) newBaseVal = 0;
    if (newBaseVal > baseMax) newBaseVal = baseMax;

    await actor.update({ "system.pools.pv.value": newBaseVal });

    const verb = effect.pv >= 0 ? "Soigne" : "Inflige";
    const amount = Math.abs(effect.pv);

    return `${verb} ${amount} PV → ${effVal}/${effMax}`;
  }

  // --- AUTRES TYPES D'EFFETS ------------------------------------------------
  if (effect.type === "healOverTime") {
    return `Effet sur la durée : ${effect.pv} PV par ${effect.time} (à gérer narrativement).`;
  }

  if (effect.type === "statCheck") {
    return `Test requis : ${effect.stat} (difficulté ${effect.diff}).`;
  }

  return `Note : ${effect.raw || "—"}`;
}

async function rollStatCheck(actor, item, effect) {
  const statKey = effect.stat;
  const rawDie = actor.system?.attributes?.[statKey] || "d6";

  const facesMatch = String(rawDie).match(/(\d+)/);
  const faces = facesMatch ? facesMatch[1] : "6";

  const mode = await Dialog.prompt({
    title: `Test de ${statKey} — ${item.name}`,
    content: `
      <form>
        <div class="form-group">
          <label>Mode :</label>
          <select name="mode">
            <option value="normal">Normal</option>
            <option value="adv">Avantage</option>
            <option value="disadv">Désavantage</option>
          </select>
        </div>
      </form>
    `,
    label: "Lancer",
    callback: html => html.find("[name='mode']").val()
  });

  if (!mode) return `Test annulé.`;

  let formula;
  if (mode === "adv") formula = `2d${faces}kh1`;
  else if (mode === "disadv") formula = `2d${faces}kl1`;
  else formula = `1d${faces}`;

  const roll = await (new Roll(formula)).roll({ async: true });

  roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<strong>${item.name}</strong> — Test de ${statKey} (diff. ${effect.diff}, ${mode})`
  });

  return `Jet de ${statKey} : ${roll.total} (diff. ${effect.diff})`;
}

// ---------------------------------------------------------------------------
// UTILISATION D’UN OBJET (actif) : UNICREON.USE
// ---------------------------------------------------------------------------

async function useItem(item) {
  const owner = item.parent;
  if (!owner) {
    return ui.notifications.warn("L'objet doit être dans l'inventaire d'un acteur.");
  }

  const sys = item.system || {};

  // Coût en PV du sort (si > 0)
  if (item.type === "spell" && sys.costPV > 0) {
    const actorPV = targetActor.system?.pools?.pv;
    const newVal = Math.max(0, Number(actorPV.value) - Number(sys.costPV));
    await targetActor.update({ "system.pools.pv.value": newVal });
  }

  // Cible : token ciblé > token contrôlé > porteur lui-même
  const targets = Array.from(game.user?.targets ?? []);
  const targetToken =
    targets[0] ||
    canvas.tokens.controlled[0] ||
    owner.getActiveTokens()[0];

  const targetActor = targetToken?.actor || owner;

  const tag =
    sys.effectTag ||  // ancien nom
    sys.unicreonTag ||  // nom possible selon ton template
    sys.activeTag ||
    sys.effectActive ||
    sys.unicreonUse ||
    "";
  const effect = parseEffectTag(tag);

  let result;
  if (!effect) {
    result = "Aucun effet actif défini sur cet objet.";
  } else if (effect.type === "statCheck") {
    result = await rollStatCheck(targetActor, item, effect);
  } else {
    result = await applyEffect(targetActor, effect);
  }

  // Gestion des utilisations
  let uses = Number(sys.uses ?? 0);
  const max = Number(sys.usesMax ?? 0);

  if (max > 0 && uses > 0) {
    uses = uses - 1;
    await item.update({ "system.uses": uses });
  }

  // Destruction éventuelle si "Détruire après usage ?" est coché
  if (sys.destroyOnUse && (max === 0 || uses <= 0)) {
    await item.delete();
  }

  // Message de chat
  const card = `
    <div class="unicreon-card">
      <h2>${owner.name} utilise ${item.name}</h2>
      <p><b>Cible :</b> ${targetActor.name}</p>
      <p>${result}</p>
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: owner }),
    content: card
  });
}

// ---------------------------------------------------------------------------
// READY : expose l’API dans game.unicreon
// ---------------------------------------------------------------------------

Hooks.once("ready", () => {
  const api = {
    parseEffectTag,
    parsePassiveTag,
    applyEffect,
    useItem
  };

  game.unicreon = Object.assign({}, game.unicreon || {}, api);

  console.log("Unicreon | API exposée :", game.unicreon);
});

// ---------------------------------------------------------------------------
// Helpers Handlebars globaux
// ---------------------------------------------------------------------------
Hooks.once("init", () => {
  console.log("Unicreon | register Handlebars helpers (from unicreon.js)");

  const hb = globalThis.Handlebars || window.Handlebars;
  if (!hb) {
    console.error("Unicreon | Handlebars global introuvable");
    return;
  }

  // Capitalise la première lettre
  hb.registerHelper("capitalize", s =>
    (s ?? "").charAt(0).toUpperCase() + (s ?? "").slice(1)
  );

  // Pour les <option> : "selected" si a == b
  hb.registerHelper("optionSel", (a, b) => (a == b ? "selected" : ""));

  // "d6" -> 6, "d10" -> 10, "0" -> 0
  hb.registerHelper("dieFaces", d =>
    (!d || d === "0") ? 0 : Number(String(d).replace("d", ""))
  );

  // Incrémente un index (pour les #each)
  hb.registerHelper("inc", n => Number(n) + 1);

  // Égalité stricte
  hb.registerHelper("eq", (a, b) => a === b);

  // a || b
  hb.registerHelper("or", (a, b) => Boolean(a || b));
});