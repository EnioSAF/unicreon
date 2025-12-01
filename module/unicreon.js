// ============================================================================
// UNICREON – Core système "light"
// - Objets : effets passifs (équipés) + effets actifs (à l’usage)
// - Actions / déplacement par tour
// - Passe d’armes générique à partir d’un item offensif (game.unicreon.resolveAttackFromItem)
// ============================================================================

// ---------------------------------------------------------------------------
// Statuts visuels (icônes Foundry) – constantes
// ---------------------------------------------------------------------------

// Identifiants internes des statuts Foundry (remplis à l'init)
const UNICREON_STATUS_IDS = {
  defensePhysical: null,
  defenseMental: null,
  dead: null
};

// Labels logiques utilisés partout
const UNICREON_STATUS_LABELS = {
  defensePhysical: "unicreon-defense-physical",
  defenseMental: "unicreon-defense-mental",
  dead: "dead",
  invisible: "unicreon-invisible",
  sleep: "unicreon-sleep",
  confused: "unicreon-confused",
  levitate: "unicreon-levitate"
};

Hooks.once("init", () => {
  console.log("Unicreon | register Handlebars helpers + status (from unicreon.js)");

  // Handlebars
  const hb =
    foundry?.applications?.api?.Handlebars ??
    globalThis.Handlebars ??
    window.Handlebars;

  if (!hb) {
    console.error("Unicreon | Handlebars introuvable");
    return;
  }

  hb.registerHelper("capitalize", s => (s ?? "").charAt(0).toUpperCase() + (s ?? "").slice(1));
  hb.registerHelper("optionSel", (a, b) => (a == b ? "selected" : ""));
  hb.registerHelper("dieFaces", d => (!d || d === "0") ? 0 : Number(String(d).replace("d", "")));
  hb.registerHelper("inc", n => Number(n) + 1);
  hb.registerHelper("eq", (a, b) => a === b);
  hb.registerHelper("or", (a, b) => Boolean(a || b));

  // --- Status Effects ---
  const statusList = CONFIG.statusEffects ?? [];

  const findByLabel = (regex) =>
    statusList.find(e => String(e.label ?? e.name ?? e.id ?? "").toLowerCase().match(regex));

  const ensureStatus = (id, label, icon) => {
    let eff = statusList.find(e => e.id === id);
    if (!eff) {
      eff = { id, label, icon };
      statusList.push(eff);
    }
    return eff;
  };

  const physEff =
    findByLabel(/protection sacr[eé]/i) ||
    ensureStatus("unicreon-defense-physical", "Défense physique", "icons/svg/shield.svg");

  const mentalEff =
    findByLabel(/protection magique/i) ||
    ensureStatus("unicreon-defense-mental", "Défense magique", "icons/svg/aura.svg");

  const deadEff =
    findByLabel(/mort|dead/i) ||
    ensureStatus("unicreon-dead", "Mort", "icons/svg/skull.svg");

  const invisEff =
    ensureStatus("unicreon-invisible", "Invisible", "icons/svg/invisible.svg");

  const sleepEff =
    ensureStatus("unicreon-sleep", "Endormi", "icons/svg/sleep.svg");

  const halluEff =
    ensureStatus("unicreon-confused", "Hallucinations", "icons/svg/daze.svg");

  const levEff =
    ensureStatus("unicreon-levitate", "Lévitation", "icons/svg/wing.svg");

  // REMPLIR LES IDS OFFICIELS
  UNICREON_STATUS_IDS.defensePhysical = physEff.id;
  UNICREON_STATUS_IDS.defenseMental = mentalEff.id;
  UNICREON_STATUS_IDS.dead = deadEff.id;
  UNICREON_STATUS_IDS.invisible = invisEff.id;
  UNICREON_STATUS_IDS.sleep = sleepEff.id;
  UNICREON_STATUS_IDS.confused = halluEff.id;
  UNICREON_STATUS_IDS.levitate = levEff.id;

  console.log("Unicreon | Status IDs :", UNICREON_STATUS_IDS);
});

// ---------------------------------------------------------------------------
// Fonctions pour retrouver / appliquer les statuts
// ---------------------------------------------------------------------------

function unicreonFindStatusEntry(key) {
  if (!CONFIG.statusEffects) return null;

  // D'abord : on tente avec l'id qu'on a stocké
  const id = UNICREON_STATUS_IDS[key];
  if (id) {
    const byId = CONFIG.statusEffects.find(e => e.id === id);
    if (byId) return byId;
  }

  // Sinon on tente avec le "label" de secours
  const wanted = UNICREON_STATUS_LABELS[key];
  if (!wanted) return null;

  return CONFIG.statusEffects.find(e =>
    e.id === wanted ||
    e.label === wanted ||
    e.name === wanted
  ) || null;
}

// ============================================================================
// HOOK : mise à jour icône "Mort" en fonction des PV
// ============================================================================

Hooks.on("updateActor", (actor, changed, options, userId) => {
  // On ne s'intéresse qu'aux changements de PV
  const hasPvChange =
    foundry.utils.getProperty(changed, "system.pools.pv.value") !== undefined ||
    foundry.utils.getProperty(changed, "system.pools.pv.max") !== undefined;

  if (!hasPvChange) return;

  const sys = actor.system ?? {};
  const pv = sys.pools?.pv ?? {};
  const val = Number(pv.value ?? 0);
  const dead = val <= 0;

  // Icône "Mort" (non overlay, tu peux passer overlay: true si tu veux la grosse icône)
  unicreonSetStatus(actor, "dead", dead, { overlay: false });
});

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

  // [pv.max +2], [pk.max -1], [ps.max +1]
  const mPool = tag.match(/\[(pv\.max|pk\.max|ps\.max)\s*([+-]?\d+)\]/i);
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

  // --- AUTRES TYPES D'EFFETS ----------------------------------------------
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

  const roll = new Roll(formula);
  await roll.evaluate();

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<strong>${item.name}</strong> — Test de ${statKey} (diff. ${effect.diff}, ${mode})`
  });

  return `Jet de ${statKey} : ${roll.total} (diff. ${effect.diff})`;
}

// ============================================================================
// UNICREON – Effets nommés par clé (dôme, invisibilité, hallucinations...)
// ============================================================================

async function applyNamedEffect({ actor, item, key }) {
  if (!actor || !key) return null;

  const name = item?.name || key;
  const lower = String(key).toLowerCase();

  // Tu peux adapter la durée par défaut en rounds (1 round ~ 1 tour)
  let effect = null;

  // -------------------------------------------------------------------------
  // DÔME DE PROTECTION (bouclier défensif temporaire)
  // -------------------------------------------------------------------------
  if (lower === "dome_protection") {
    effect = await unicreonCreateTimedEffect({
      actor,
      label: "Dôme de protection",
      statusKey: "defensePhysical",
      rounds: 3,
      changes: [
        // Exemple : flag utilisable par ta logique plus tard
        { key: "flags.unicreon.domeProtection", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "1" }
      ]
    });
    return `${actor.name} bénéficie d'un <strong>Dôme de protection</strong> pendant 3 tours.`;
  }

  // -------------------------------------------------------------------------
  // SANCTUAIRE PROTECTEUR (version longue / rituelle)
  // -------------------------------------------------------------------------
  if (lower === "sanctuaire") {
    effect = await unicreonCreateTimedEffect({
      actor,
      label: "Sanctuaire protecteur",
      statusKey: "defenseMental",
      rounds: 5,
      changes: [
        { key: "flags.unicreon.sanctuary", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "1" }
      ]
    });
    return `${actor.name} est dans un <strong>Sanctuaire</strong> protecteur (bonus narratif aux jets défensifs).`;
  }

  // -------------------------------------------------------------------------
  // INVISIBILITÉ
  // -------------------------------------------------------------------------
  if (lower === "invisibilite") {
    effect = await unicreonCreateTimedEffect({
      actor,
      label: "Invisibilité",
      statusKey: "invisible",
      rounds: 5,
      changes: [
        { key: "flags.unicreon.invisible", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "1" }
      ]
    });
    return `${actor.name} devient <strong>invisible</strong> pendant quelques tours (malus aux attaques contre lui, à la discrétion du MJ).`;
  }

  // -------------------------------------------------------------------------
  // SOMMEIL / ENDORMI
  // -------------------------------------------------------------------------
  if (lower === "sleep" || lower === "sommeil") {
    effect = await unicreonCreateTimedEffect({
      actor,
      label: "Endormi",
      statusKey: "sleep",
      rounds: 4,
      changes: [
        { key: "flags.unicreon.asleep", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "1" }
      ]
    });
    return `${actor.name} est <strong>endormi</strong> et ne peut pas agir tant que l'effet persiste.`;
  }

  // -------------------------------------------------------------------------
  // HALLUCINATIONS
  // -------------------------------------------------------------------------
  if (lower === "hallucinations") {
    effect = await unicreonCreateTimedEffect({
      actor,
      label: "Hallucinations",
      statusKey: "confused",
      rounds: 3,
      changes: [
        { key: "flags.unicreon.hallu", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "1" }
      ]
    });
    return `${actor.name} subit de fortes <strong>hallucinations</strong> (malus à toutes les actions, à la discrétion du MJ).`;
  }

  // -------------------------------------------------------------------------
  // LEVITATION
  // -------------------------------------------------------------------------
  if (lower === "levitation") {
    effect = await unicreonCreateTimedEffect({
      actor,
      label: "Lévitation",
      statusKey: "levitate",
      rounds: 3,
      changes: [
        { key: "flags.unicreon.levitating", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "1" }
      ]
    });
    return `${actor.name} <strong>lévite</strong> au-dessus du sol pendant quelques tours.`;
  }

  // -------------------------------------------------------------------------
  // PAR DÉFAUT : rien de spécial, on laisse juste le tag faire le taf
  // -------------------------------------------------------------------------
  return null;
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

  // -----------------------------------------------------------------------
  // 1) Détection magie + config d'attaque
  // -----------------------------------------------------------------------
  const magicTypes = ["incantation", "pouvoir", "rituel", "sort", "spell"];
  const isMagic = magicTypes.includes(item.type);

  const psPool = owner.system?.pools?.ps ?? {};
  const psCurrent = Number(psPool.value ?? 0) || 0;
  const psMax = Number(psPool.max ?? 0) || 0;
  const costPS = Number(sys.costPS ?? 0) || 0;

  const atkCfg = sys.attack || {};
  const isAttackSpell =
    isMagic && atkCfg.enabled && typeof game.unicreon?.resolveAttackFromItem === "function";

  const api = game.unicreon || {};
  const getActionsFn = api.getActionsLeft || getActionsLeft;
  const spendActionsFn = api.spendActions || spendActions;

  const inActiveTurn = isActorInActiveCombatTurn(owner);

  // Coût en actions :
  // - sort OFFENSIF → system.attack.actionsCost (défaut 1)
  // - sort utilitaire → system.actionsCost (défaut 1)
  let actionsCost = 0;
  if (isAttackSpell) {
    actionsCost = Number(atkCfg.actionsCost ?? 1);
  } else {
    actionsCost = Number(sys.actionsCost ?? 1);
  }
  if (!Number.isFinite(actionsCost) || actionsCost < 0) actionsCost = 0;

  let actionsLeft = UNICREON_ACTIONS_PER_TURN;
  if (typeof getActionsFn === "function") {
    actionsLeft =
      Number(getActionsFn(owner) ?? UNICREON_ACTIONS_PER_TURN) || 0;
  }

  // -----------------------------------------------------------------------
  // 2) BLOQUAGES – PS & actions (uniquement pour les sorts)
  // -----------------------------------------------------------------------
  if (isMagic) {
    // a) PS à 0 et un pool PS existe → plus de sorts du tout
    if (psMax > 0 && psCurrent <= 0) {
      ui.notifications.warn(`${owner.name} n'a plus de points de sorts.`);
      return;
    }

    // b) Coût PS spécifique au sort
    if (costPS > 0 && psCurrent < costPS) {
      ui.notifications.warn(
        `${owner.name} n'a pas assez de points de sorts pour lancer "${item.name}" (${psCurrent}/${costPS}).`
      );
      return;
    }

    // c) Coût en actions → uniquement en combat & pendant son tour
    if (inActiveTurn && actionsCost > 0 && actionsLeft < actionsCost) {
      ui.notifications.warn(
        `${owner.name} n'a pas assez d'actions pour "${item.name}" (${actionsLeft}/${actionsCost}).`
      );
      return;
    }
  }

  // -----------------------------------------------------------------------
  // 3) Paiement des points de sorts (déjà validé plus haut)
  // -----------------------------------------------------------------------
  if (isMagic && costPS > 0) {
    const newPs = Math.max(0, psCurrent - costPS);
    await owner.update({ "system.pools.ps.value": newPs });
  }

  // -----------------------------------------------------------------------
  // 4) Cible & tokens
  // -----------------------------------------------------------------------
  const targets = Array.from(game.user?.targets ?? []);
  const attackerToken =
    owner.getActiveTokens()[0] ||
    canvas.tokens.controlled[0] ||
    null;

  const targetToken =
    targets[0] ||
    canvas.tokens.controlled[0] ||
    owner.getActiveTokens()[0] ||
    null;

  const targetActor = targetToken?.actor || owner;

  // -----------------------------------------------------------------------
  // 5) CAS 1 : SORT OFFENSIF → passe d’armes magique
  // -----------------------------------------------------------------------
  if (isAttackSpell) {
    if (!attackerToken) {
      ui.notifications.warn(
        "Sélectionne d'abord le token du lanceur avant d'utiliser ce sort offensif."
      );
      return;
    }
    if (!targetToken) {
      ui.notifications.warn(
        "Vise un token défenseur (Alt+clic) avant d'utiliser ce sort offensif."
      );
      return;
    }

    // On laisse resolveAttackFromItem :
    // - gérer le jet Pouvoir/Volonté
    // - gérer la défense (avec Résistance magique éventuelle)
    // - appliquer les dégâts PV
    // - consommer les actions (via attack.actionsCost)
    await game.unicreon.resolveAttackFromItem({
      actor: owner,
      attackerToken,
      targetToken,
      item
    });

    // On gère quand même les "usages" / destruction après usage
    let uses = Number(sys.uses ?? 0);
    const max = Number(sys.usesMax ?? 0);

    if (max > 0 && uses > 0) {
      uses = uses - 1;
      await item.update({ "system.uses": uses });
    }
    if (sys.destroyOnUse && (max === 0 || uses <= 0)) {
      await item.delete();
    }

    // Pas de carte de chat ici : resolveAttackFromItem en a déjà fait une.
    return;
  }

  // -----------------------------------------------------------------------
  // 6) CAS 2 : sort/objet "utilitaire" → ancien système à tag d'effet
  // -----------------------------------------------------------------------
  const tag =
    sys.effectTag ||      // ancien nom
    sys.unicreonTag ||    // nom possible selon ton template
    sys.activeTag ||
    sys.effectActive ||
    sys.unicreonUse ||
    "";

  // Clé d'effet "structurée" pour les effets visuels / persistants
  const effectKey =
    sys.effectKey ||
    sys.unicreonEffectKey ||
    "";

  const effect = parseEffectTag(tag);

  let resultLines = [];

  if (effectKey) {
    const namedRes = await applyNamedEffect({ actor: targetActor, item, key: effectKey });
    if (namedRes) resultLines.push(namedRes);
  }

  if (!effect && !effectKey) {
    resultLines.push("Aucun effet actif défini sur cet objet.");
  } else if (effect && effect.type === "statCheck") {
    resultLines.push(await rollStatCheck(targetActor, item, effect));
  } else if (effect && effect.type !== "statCheck") {
    resultLines.push(await applyEffect(targetActor, effect));
  }

  const result = resultLines.filter(Boolean).join("<br/>");

  // Gestion des utilisations
  let uses = Number(sys.uses ?? 0);
  const max = Number(sys.usesMax ?? 0);

  if (max > 0 && uses > 0) {
    uses = uses - 1;
    await item.update({ "system.uses": uses });
  }

  if (sys.destroyOnUse && (max === 0 || uses <= 0)) {
    await item.delete();
  }

  // Consommation des actions pour les sorts utilitaires (combat only)
  if (isMagic && actionsCost > 0 && inActiveTurn && typeof spendActionsFn === "function") {
    await spendActionsFn(owner, actionsCost);
    if (typeof getActionsFn === "function") {
      actionsLeft = Number(getActionsFn(owner) ?? 0) || 0;
    }
  }

  const extraCostText = [];

  if (isMagic && costPS > 0) {
    extraCostText.push(`${costPS} PS`);
  }
  if (isMagic && actionsCost > 0 && inActiveTurn) {
    extraCostText.push(`${actionsCost} action(s)`);
  }

  const costLine = extraCostText.length
    ? `<p><strong>Coût :</strong> ${extraCostText.join(" + ")}</p>`
    : "";

  const actionsLine =
    isMagic && inActiveTurn && actionsCost > 0
      ? `<p><strong>Actions restantes :</strong> ${actionsLeft}</p>`
      : "";

  const card = `
    <div class="unicreon-card">
      <h2>${owner.name} utilise ${item.name}</h2>
      <p><strong>Cible :</strong> ${targetActor.name}</p>
      ${costLine}
      <p>${result}</p>
      ${actionsLine}
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: owner }),
    content: card
  });
}

/// ============================================================================
// UNICREON – ACTIONS PAR TOUR
// ============================================================================

// L'acteur est-il en plein tour de combat ?
function isActorInActiveCombatTurn(actor) {
  if (!actor) return false;

  const combat = game.combat;
  if (!combat) return false;

  const combatant = combat.combatant;
  if (!combatant || !combatant.actor) return false;

  return combatant.actor.id === actor.id;
}

const UNICREON_ACTIONS_PER_TURN = 2;

/** Combien d'actions restent à cet acteur pour CE tour ? */
function getActionsLeft(actor) {
  if (!actor) return 0;

  // Total "normal" (config globale ou fallback)
  const defaultTotal =
    Number(game.unicreon?.actionsPerTurn ?? UNICREON_ACTIONS_PER_TURN) ||
    UNICREON_ACTIONS_PER_TURN;

  // HORS COMBAT ou PAS son tour :
  // → on considère qu'il est libre, donc il a toujours son total d'actions.
  if (!isActorInActiveCombatTurn(actor)) {
    return defaultTotal;
  }

  // EN COMBAT, pendant SON tour → on lit le flag
  const current = actor.getFlag("unicreon", "actionsLeft");
  if (current === undefined || current === null) return defaultTotal;
  return Number(current) || 0;
}

/** Fixe le nombre d'actions restantes pour cet acteur. */
async function setActionsLeft(actor, value) {
  if (!actor) return;
  const v = Math.max(0, Number(value) || 0);
  await actor.setFlag("unicreon", "actionsLeft", v);
  return v;
}

/** Réinitialise les actions au début du tour de cet acteur. */
async function resetActionsForActor(actor) {
  if (!actor) return 0;

  let total = Number(actor.getFlag("unicreon", "actionsTotal"));

  if (!Number.isFinite(total) || total <= 0) {
    total =
      Number(game.unicreon?.actionsPerTurn ?? UNICREON_ACTIONS_PER_TURN) ||
      UNICREON_ACTIONS_PER_TURN;
  }

  await setActionsLeft(actor, total);
  return total;
}

/** Consomme des actions (1 par défaut). Renvoie le nombre restant. */
async function spendActions(actor, count = 1) {
  if (!actor) return 0;

  // HORS COMBAT ou PAS son tour :
  // → on NE consomme PAS les actions, on ne bloque jamais.
  if (!isActorInActiveCombatTurn(actor)) {
    return getActionsLeft(actor);
  }

  const before = getActionsLeft(actor);
  const after = Math.max(
    0,
    before - Math.max(1, Number(count) || 1)
  );
  await setActionsLeft(actor, after);

  if (after <= 0) {
    ui.notifications.info(
      `${actor.name} n'a plus d'action pour ce tour.`
    );
  }

  return after;
}

// ============================================================================
// UNICREON – POINTS DE MOUVEMENT (PM)
// ============================================================================
// -> Le MJ / la feuille définit pm.max à la main.
// -> On ne fait que dépenser / remettre à pm.max au début du tour.
// ============================================================================

/** Lit le pool de PM de l'acteur (valeur + max). */
function getMovePool(actor) {
  const pm = actor.system?.pools?.pm ?? {};
  let max = Number(pm.max ?? 0);
  if (!Number.isFinite(max) || max < 0) max = 0;

  let value = Number(pm.value ?? max);
  if (!Number.isFinite(value) || value < 0) value = 0;
  if (value > max) value = max;

  return { value, max };
}

/** PM restants. */
function getMoveLeft(actor) {
  return getMovePool(actor).value;
}

/** PM max (défini dans la fiche). */
function getMoveMax(actor) {
  return getMovePool(actor).max;
}

/** Fixe les PM restants sans toucher au max. */
async function setMove(actor, value) {
  if (!actor) return 0;
  const { max } = getMovePool(actor);
  const clamped = Math.max(0, Math.min(max, Number(value) || 0));

  await actor.update({
    "system.pools.pm.value": clamped
  });

  return clamped;
}

/** Remet les PM à leur max (pm.max). */
async function resetMoveForActor(actor) {
  if (!actor) return 0;
  const { max } = getMovePool(actor);

  await actor.update({
    "system.pools.pm.value": max
  });

  return max;
}

/** Dépense des PM (ne jamais passer en négatif). */
async function spendMove(actor, cost) {
  if (!actor) return 0;
  const { value, max } = getMovePool(actor);
  const remaining = Math.max(0, value - Math.max(0, Number(cost) || 0));

  await actor.update({
    "system.pools.pm.value": remaining
  });

  return remaining;
}

// ---------------------------------------------------------------------------
// RÉINITIALISATION AUTOMATIQUE AU DÉBUT DU TOUR
// ---------------------------------------------------------------------------

Hooks.on("updateCombat", async (combat, change, options, userId) => {
  // On ne s'intéresse qu'au changement de "turn"
  if (!("turn" in change)) return;

  const combatant = combat.combatant;
  if (!combatant?.actor) return;

  const actor = combatant.actor;

  // ------- PM : on remet juste la valeur au max défini sur la fiche -------
  await resetMoveForActor(actor);

  // ------- ACTIONS : on remet à son total (flag ou config globale) -------
  await resetActionsForActor(actor);
});

// ============================================================================
// HOOK : LIMITATION DE DÉPLACEMENT
// ============================================================================

Hooks.on("preUpdateToken", (tokenDoc, change, options, userId) => {
  if (change.x === undefined && change.y === undefined) return;

  const actor = tokenDoc.actor;
  if (!actor) return;

  // Seulement si combat + c’est SON tour
  const combat = game.combat;
  if (!combat || !combat.combatant) return;
  if (combat.combatant.tokenId !== tokenDoc.id) return;

  const moveLeft = getMoveLeft(actor);
  if (moveLeft <= 0) {
    ui.notifications.warn(`${actor.name} n'a plus de points de mouvement.`);
    return false;
  }

  // Positions
  const fromX = tokenDoc.x;
  const fromY = tokenDoc.y;
  const toX = change.x ?? tokenDoc.x;
  const toY = change.y ?? tokenDoc.y;

  const grid = canvas.grid.size;
  const dx = (toX - fromX) / grid;
  const dy = (toY - fromY) / grid;

  const distance = Math.hypot(dx, dy);
  const cost = Math.ceil(distance);

  if (cost > moveLeft) {
    ui.notifications.warn(
      `${actor.name} dépasse sa limite de déplacement (${cost} > ${moveLeft})`
    );
    return false;
  }

  spendMove(actor, cost);
});

// ============================================================================
// UNICREON – HELPERS PASSE D'ARMES
// ============================================================================

const UNICREON_CARACS = ["puissance", "agilite", "perception", "volonte", "pouvoir"];

function unicreonCaracLabel(key) {
  const labels = {
    puissance: "Puissance",
    agilite: "Agilité",
    perception: "Perception",
    volonte: "Volonté",
    pouvoir: "Pouvoir"
  };
  return labels[key] || key;
}

function unicreonGetCaracFaces(actor, key) {
  const die = actor.system?.attributes?.[key] ?? "d6";
  const m = String(die).match(/d(\d+)/i);
  return m ? Number(m[1]) : 6;
}

function unicreonGetPV(actor) {
  return Number(actor.system?.pools?.pv?.value ?? 0);
}

async function unicreonSetPV(actor, value) {
  const max = Number(actor.system?.pools?.pv?.max ?? value);
  const final = Math.max(0, Math.min(max, Number(value) || 0));
  await actor.update({ "system.pools.pv.value": final });
  return final;
}

function unicreonGetPK(actor) {
  return Number(actor.system?.pools?.pk?.value ?? 0);
}

async function unicreonSpendPK(actor, amount) {
  if (!amount || amount <= 0) return;
  const current = unicreonGetPK(actor);
  const final = Math.max(0, current - amount);
  await actor.update({ "system.pools.pk.value": final });
}

// Construit la formule de jet : normal / avantage / désavantage
function unicreonBuildFormula(faces, mode) {
  const f = Number(faces) || 6;
  if (mode === "adv") return `2d${f}kh1`;
  if (mode === "disadv") return `2d${f}kl1`;
  return `1d${f}`;
}

// Test pour la passe d'armes
async function unicreonRollTest({ actor, caracKey, baseDiff, pkSpent, mode, label }) {
  const faces = unicreonGetCaracFaces(actor, caracKey);
  const diff = Math.max(2, baseDiff - (pkSpent || 0)); // 1 PK = diff -1, min 2
  const formula = unicreonBuildFormula(faces, mode || "normal");
  const roll = new Roll(formula);
  await roll.evaluate();
  const success = roll.total >= diff;
  return { actor, caracKey, label, roll, faces, diff, success, mode: mode || "normal" };
}

// ============================================================================
// UNICREON – JET DE COMPETENCE STANDARD
// ============================================================================

async function rollCompetence(item) {
  const actor = item.actor ?? item.parent;
  if (!actor) {
    ui.notifications.warn("Cette compétence doit être sur un acteur.");
    return;
  }

  const name = (item.name || "").toLowerCase();

  // -------------------------------------------------------------
  // 0) Cas spécial : Résistance physique / mentale = posture
  //    (aucun jet, juste la posture + icône + message + action)
  // -------------------------------------------------------------
  if (game.unicreon?.useDefenseStance &&
    (name.includes("résistance physique") || name.includes("resistance physique") ||
      name.includes("résistance mentale") || name.includes("resistance mentale"))) {

    return game.unicreon.useDefenseStance(item);
  }

  // -------------------------------------------------------------
  // 1) Jet standard : Carac + Compétence (comme avant)
  // -------------------------------------------------------------
  const sys = item.system || {};
  const caracKey = sys.caracKey || "puissance";

  const caracDie = actor.system?.attributes?.[caracKey] || "d6";
  const compDie = sys.level || "d6";

  const caracFacesMatch = String(caracDie).match(/(\d+)/);
  const compFacesMatch = String(compDie).match(/(\d+)/);

  const caracFaces = caracFacesMatch ? Number(caracFacesMatch[1]) : 6;
  const compFaces = compFacesMatch ? Number(compFacesMatch[1]) : 6;

  // Choix du mode (normal / avantage / désavantage) pour la compétence
  const mode = await Dialog.prompt({
    title: `${actor.name} — ${item.name}`,
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

  // Carac = toujours 1 dé
  const caracRoll = await (new Roll(`1d${caracFaces}`)).evaluate();

  // Compétence = selon le mode
  let compFormula;
  if (mode === "adv") compFormula = `2d${compFaces}kh1`;
  else if (mode === "disadv") compFormula = `2d${compFaces}kl1`;
  else compFormula = `1d${compFaces}`;

  const compRoll = await (new Roll(compFormula)).evaluate();

  // Résultat final = max(carac, compétence)
  const final = Math.max(caracRoll.total, compRoll.total);

  const caracLabel = unicreonCaracLabel(caracKey);

  const content = `
    <div class="unicreon-card">
      <h2>${actor.name} — ${item.name}</h2>
      <p><strong>Carac (${caracLabel}) :</strong> 1d${caracFaces} → ${caracRoll.total}</p>
      <p><strong>Compétence (d${compFaces}, ${mode}) :</strong> ${compRoll.total}</p>
      <p><strong>Résultat gardé :</strong> ${final}</p>
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });
}

// ============================================================================
// UNICREON – EFFETS NOMMÉS → ActiveEffect + icône de statut
// ============================================================================

/**
 * Crée un ActiveEffect "simple" sur un acteur, avec :
 * - label (nom affiché)
 * - icône (ou récupérée via unicreonFindStatusEntry)
 * - durée en rounds
 * - éventuelles "changes" pour modifier le système
 */
async function unicreonCreateTimedEffect({
  actor,
  label,
  statusKey = null,   // ex: "defensePhysical", "invisible", "sleep"
  rounds = 1,
  changes = []
}) {
  if (!actor) return null;

  let icon = null;

  if (statusKey) {
    const entry = unicreonFindStatusEntry(statusKey);
    if (entry) icon = entry.icon || entry.id || null;

    // Applique / retire aussi le statut de token
    await unicreonSetStatus(actor, statusKey, true, { overlay: false });
  }

  const effectData = {
    label: label,
    icon: icon || "icons/svg/aura.svg",
    disabled: false,
    origin: actor.uuid,
    duration: {
      rounds: Math.max(1, Number(rounds) || 1),
      startRound: game.combat?.round ?? 0,
      startTime: game.time.worldTime ?? 0
    },
    changes: changes,
    flags: {
      unicreon: {
        isNamedEffect: true,
        statusKey: statusKey || null
      }
    }
  };

  const effect = await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
  return effect[0] ?? null;
}

/**
 * Retire proprement un effet nommé + l’icône de statut associée.
 * Appelé automatiquement par Foundry quand la durée expire,
 * si tu ajoutes un hook plus tard (optionnel).
 */
async function unicreonRemoveNamedEffect(actor, effect) {
  if (!actor || !effect) return;

  const statusKey = effect.getFlag("unicreon", "statusKey");
  if (statusKey) {
    await unicreonSetStatus(actor, statusKey, false, { overlay: false });
  }
}

// ============================================================================
// UNICREON – PROFIL D'ÉQUIPEMENT DÉFENSIF
// ============================================================================
function unicreonGetDefensiveEquipProfile(actor, { attackType = "melee" } = {}) {
  const profile = {
    caracKey: null,   // carac de défense "suggérée"
    bonus: 0,         // bonus plat au jet de défense
    absorption: 0,    // PV absorbés si l'attaque touche
    items: []         // liste des items qui ont contribué
  };

  if (!actor) return profile;

  const isPhysical = attackType === "melee" || attackType === "ranged";

  const allItems = actor.items?.contents ?? actor.items ?? [];
  for (const item of allItems) {
    const sys = item.system ?? {};

    const isArmor = item.type === "armure";
    const isShield = sys.category === "bouclier" || item.type === "bouclier";

    if (!isArmor && !isShield) continue;

    // On ne prend en compte que les objets équipés
    if (!sys.equippable || !sys.equipped) continue;

    const def = sys.defense ?? {};
    const caracKeyRaw = (def.caracKey || "").toLowerCase();
    const bonus = Number(def.bonus ?? 0) || 0;
    const absorption = Number(def.absorption ?? 0) || 0;

    // Par défaut : armure/bouclier ne servent que contre les attaques physiques
    if (!isPhysical) continue;

    // Carac de défense proposée par l'armure/bouclier
    if (!profile.caracKey && caracKeyRaw && UNICREON_CARACS.includes(caracKeyRaw)) {
      profile.caracKey = caracKeyRaw;
    }

    if (bonus || absorption) {
      profile.items.push({ item, bonus, absorption, caracKey: caracKeyRaw });
      profile.bonus += bonus;
      profile.absorption += absorption;
    }
  }

  return profile;
}

// ============================================================================
// UNICREON – ANIMATIONS JB2A / SEQUENCER
// ============================================================================

/**
 * Petit helper : prend une liste de clés JB2A et renvoie
 * la première qui existe vraiment dans la base Sequencer.
 */
function unicreonPickFirstExistingJB2A(keys = []) {
  const db = Sequencer?.Database;
  if (!db) return null;

  for (const k of keys) {
    if (!k) continue;
    if (db.entryExists(k)) return k;
  }
  return null;
}

/**
 * Joue une animation d'attaque via Sequencer + JB2A
 *
 * @param {object} params
 * @param {"melee"|"ranged"|"spell"} params.attackType
 * @param {Token} params.attackerToken
 * @param {Token} params.targetToken
 * @param {boolean} [params.hit=true]  // true = touche, false = esquive
 */
async function unicreonPlayAttackAnimation({
  attackType = "melee",
  attackerToken,
  targetToken,
  hit = true
} = {}) {
  try {
    const hasSeq = game.modules.get("sequencer")?.active;

    // On cherche n'importe quel module dont l'id contient "jb2a"
    const jb2aModule = Array.from(game.modules.values())
      .find(m => m.active && m.id.toLowerCase().includes("jb2a"));

    const hasJB2A = !!jb2aModule;

    console.log(
      "Unicreon | Anim check → Sequencer:", hasSeq,
      "JB2A:", hasJB2A ? jb2aModule.id : "none"
    );

    if (!hasSeq || !hasJB2A) return;
    if (!attackerToken || !targetToken) return;

    if (typeof Sequence === "undefined") {
      console.warn("Unicreon | Sequence n'est pas défini (Sequencer mal chargé ?)");
      return;
    }

    // ---------------------------------------------------------------------
    // Choix des fichiers JB2A en essayant plusieurs clés possibles
    // (toutes sont dans le pack free normalement, ou très proches)
    // ---------------------------------------------------------------------

    let mainFile = null;
    let impactFile = null;

    if (attackType === "melee") {
      mainFile = unicreonPickFirstExistingJB2A([
        "jb2a.melee_generic.slash.white",
        "jb2a.melee_generic.slash.blue",
        "jb2a.sword.melee.01.white"
      ]);
      impactFile = unicreonPickFirstExistingJB2A([
        "jb2a.impact.003.white",
        "jb2a.impact.003.blue",
        "jb2a.impact.003.orange"
      ]);
    } else if (attackType === "ranged") {
      mainFile = unicreonPickFirstExistingJB2A([
        "jb2a.arrow.physical.white.01",
        "jb2a.arrow.physical.blue.01",
        "jb2a.arrow.physical.orange.01"
      ]);
      impactFile = unicreonPickFirstExistingJB2A([
        "jb2a.arrow.impact.01.white",
        "jb2a.arrow.impact.01.blue",
        "jb2a.impact.003.white"
      ]);
    } else if (attackType === "spell") {
      mainFile = unicreonPickFirstExistingJB2A([
        // projectiles de sort
        "jb2a.fire_bolt.orange",
        "jb2a.fire_bolt.red",
        "jb2a.magic_missile.single.blue",
        "jb2a.magic_missile.single.pink"
      ]);
      impactFile = unicreonPickFirstExistingJB2A([
        // explosions pour boule de feu & co
        "jb2a.explosion.02.orange",
        "jb2a.explosion.02.red",
        "jb2a.explosion.01.orange"
      ]);
    }

    // Si on n'a RIEN trouvé de valide, on ne fait juste pas d'anim
    if (!mainFile) {
      console.warn("Unicreon | aucune anim JB2A trouvée pour", attackType);
      return;
    }

    const seq = new Sequence();

    const sameSpot =
      !attackerToken || !targetToken ||
      attackerToken.document?.id === targetToken.document?.id;

    // Si attaquant et cible sont différents → projectile qui se stretch
    if (!sameSpot) {
      seq.effect()
        .file(mainFile)
        .atLocation(attackerToken)
        .stretchTo(targetToken)
        .waitUntilFinished(-250);
    } else {
      // Sinon : anim “sur place” (ex : self-buff, pas de cible, etc.)
      seq.effect()
        .file(mainFile)
        .atLocation(attackerToken || targetToken)
        .waitUntilFinished(-250);
    }

    if (hit && impactFile && targetToken && !sameSpot) {
      seq.effect()
        .file(impactFile)
        .atLocation(targetToken)
        .scale(0.7)
        .waitUntilFinished();
    }

    await seq.play();
  } catch (err) {
    console.error("Unicreon | Erreur animation Sequencer/JB2A :", err);
  }
}

// ============================================================================
// UNICREON – RESOLUTION D'ATTAQUE A PARTIR D'UN ITEM
// ============================================================================

/**
 * Passe d'armes générique à partir d'un item offensif
 *
 * @param {object} params
 * @param {Actor}  params.actor         Attaquant (acteur)
 * @param {Token}  params.attackerToken Token de l'attaquant
 * @param {Token}  params.targetToken   Token de la cible
 * @param {Item}   params.item          Compétence / arme / sort offensif
 */
async function resolveAttackFromItem({ actor, attackerToken, targetToken, item }) {
  if (!actor || !item) {
    ui.notifications.warn("resolveAttackFromItem : acteur ou item manquant.");
    return;
  }

  if (!targetToken) {
    ui.notifications.warn("Aucune cible. Vise un token défenseur (Alt+clic).");
    return;
  }

  const defender = targetToken.actor;
  if (!defender) {
    ui.notifications.warn("Le token ciblé n'a pas d'acteur.");
    return;
  }

  const actionsLeft = getActionsLeft(actor);
  if (actionsLeft <= 0) {
    ui.notifications.warn(`${actor.name} n'a plus d'action pour ce tour.`);
    return;
  }

  const atkCfg = item.system?.attack || {};
  if (!atkCfg.enabled) {
    ui.notifications.warn(
      `${item.name} n'est pas configuré comme action offensive (system.attack.enabled).`
    );
    return;
  }

  // carac d'attaque par défaut :
  // - atkCfg.caracKey          (config de l'item)
  // - item.system.caracKey     (compétence)
  // - item.system.stat         (sort Unicreon)
  // - "puissance"              (fallback)
  const defaultAttCarac =
    atkCfg.caracKey ||
    item.system?.caracKey ||
    item.system?.stat ||
    "puissance";

  // Défense :
  // - atkCfg.defaultDefense
  // - pour les items magiques : "volonte"
  // - sinon : "agilite"
  const magicTypes = ["incantation", "pouvoir", "rituel", "sort", "spell"];

  let defCarac =
    atkCfg.defaultDefense ||
    (magicTypes.includes(item.type) ? "volonte" : "agilite");

  let difficulty = atkCfg.baseDifficulty ?? 4;
  let damageStr = (atkCfg.damage || "1").toString().trim();
  const usePK = atkCfg.usePK !== false;

  // Type d'attaque : "melee" | "ranged" | "spell"
  let attackType = atkCfg.type;
  if (!attackType) {
    attackType = magicTypes.includes(item.type) ? "spell" : "melee";
  }

  const attackerPK = unicreonGetPK(actor);
  const defenderPK = unicreonGetPK(defender);

  // -----------------------------------------------------------------------
  // PROFIL D'ÉQUIPEMENT DÉFENSIF DU DÉFENSEUR (armures, boucliers, etc.)
  // -----------------------------------------------------------------------
  const equipDefense = unicreonGetDefensiveEquipProfile(defender, { attackType });
  // -> equipDefense.caracKey : carac suggérée par armure / bouclier
  // -> equipDefense.bonus    : bonus plat au jet de défense
  // -> equipDefense.absorption : PV absorbés si l'attaque touche

  // Si l'item n'impose PAS de carac de défense, on laisse l'armure en proposer une
  if (!atkCfg.defaultDefense && equipDefense.caracKey) {
    defCarac = equipDefense.caracKey;
  }

  // ---------- Dialogue ----------
  const formData = await Dialog.prompt({
    title: `Passe d'armes : ${actor.name} utilise ${item.name} sur ${defender.name}`,
    label: "Lancer",
    content: `
      <form class="unicreon-attack-from-item">

        <div class="form-group">
          <label>Caractéristique d'attaque</label>
          <select name="attCarac">
            ${UNICREON_CARACS.map(c => {
      const sel = c === defaultAttCarac ? "selected" : "";
      return `<option value="${c}" ${sel}>${unicreonCaracLabel(c)}</option>`;
    }).join("")}
          </select>
        </div>

        <div class="form-group">
          <label>Mode d'attaque</label>
          <select name="atkMode">
            <option value="normal">Normal</option>
            <option value="adv">Avantage</option>
            <option value="disadv">Désavantage</option>
          </select>
        </div>

        <div class="form-group">
          <label>Caractéristique de défense</label>
          <select name="defCarac">
            ${UNICREON_CARACS.map(c => {
      const sel = c === defCarac ? "selected" : "";
      return `<option value="${c}" ${sel}>${unicreonCaracLabel(c)}</option>`;
    }).join("")}
          </select>
        </div>

        <div class="form-group">
          <label>Difficulté de base</label>
          <input name="difficulty" type="number" value="${difficulty}" min="2" max="10"/>
          <p class="hint">4 = difficulté standard.</p>
        </div>

        <div class="form-group">
          <label>Dégâts</label>
          <input name="damage" type="text" value="${damageStr}"/>
          <p class="hint">Ex : "2" = 2 PV fixes, "max 4" = jusqu'à 4 PV selon le jet.</p>
        </div>

        <div class="form-group">
          <label>PK dépensés par ${actor.name} (max ${attackerPK})</label>
          <input name="pkA" type="number" value="0" min="0" max="${attackerPK}" ${usePK ? "" : "disabled"}/>
        </div>

        <div class="form-group">
          <label>PK dépensés par ${defender.name} (max ${defenderPK})</label>
          <input name="pkD" type="number" value="0" min="0" max="${defenderPK}" ${usePK ? "" : "disabled"}/>
        </div>
      </form>
    `,
    callback: html => {
      const $html = $(html);
      return {
        attCarac: $html.find("[name='attCarac']").val() || defaultAttCarac,
        atkMode: $html.find("[name='atkMode']").val() || "normal",
        defCarac: $html.find("[name='defCarac']").val(),
        difficulty: Number($html.find("[name='difficulty']").val()) || difficulty,
        damage: String($html.find("[name='damage']").val() || damageStr).trim(),
        pkA: usePK ? Math.max(0, Math.min(attackerPK, Number($html.find("[name='pkA']").val()) || 0)) : 0,
        pkD: usePK ? Math.max(0, Math.min(defenderPK, Number($html.find("[name='pkD']").val()) || 0)) : 0
      };
    }
  });

  if (!formData) return;

  let attCarac = formData.attCarac;
  let atkMode = formData.atkMode;
  defCarac = formData.defCarac;
  difficulty = formData.difficulty;
  damageStr = formData.damage;
  const pkA = formData.pkA;
  const pkD = formData.pkD;

  // ---------- Jets ----------
  const attTest = await unicreonRollTest({
    actor,
    caracKey: attCarac,
    baseDiff: difficulty,
    pkSpent: pkA,
    mode: atkMode,
    label: `Attaque (${unicreonCaracLabel(attCarac)})`
  });

  // Posture défensive éventuelle (Résistance physique / mentale)
  let defMode = "normal";
  let defBuffText = "";

  const stance = await consumeDefenseStance({
    defender,
    attacker: actor,
    attackType
  });

  if (stance) {
    defMode = stance.mode || "adv";

    if (stance.type === "mental") {
      defCarac = "pouvoir";       // Défense magique → Pouvoir
      defBuffText = " (Résistance magique — Pouvoir)";
    } else {
      defCarac = "puissance";     // Défense physique → Puissance
      defBuffText = " (Résistance physique — Puissance)";
    }
  }

  const defTest = await unicreonRollTest({
    actor: defender,
    caracKey: defCarac,
    baseDiff: difficulty,
    pkSpent: pkD,
    mode: defMode,
    label: `Défense (${unicreonCaracLabel(defCarac)})`
  });

  await unicreonSpendPK(actor, pkA);
  await unicreonSpendPK(defender, pkD);

  // -----------------------------------------------------------------------
  // APPLICATION DU BONUS D'ÉQUIPEMENT SUR LE JET DE DÉFENSE
  // -----------------------------------------------------------------------
  const defEquipBonus = equipDefense.bonus || 0;
  const defEquipAbsorption = (attackType === "melee" || attackType === "ranged")
    ? (equipDefense.absorption || 0)
    : 0;

  const defTotalBase = defTest.roll.total;
  const defTotalEffective = defTotalBase + defEquipBonus;
  const defSuccess = defTotalEffective >= defTest.diff;

  // -----------------------------------------------------------------------
  // DÉTERMINATION DU GAGNANT (en utilisant le total défensif modifié)
  // -----------------------------------------------------------------------
  let winner = null;
  if (attTest.success && !defSuccess) winner = "attacker";
  else if (!attTest.success && defSuccess) winner = "defender";
  else if (attTest.success && defSuccess) {
    if (attTest.roll.total > defTotalEffective) winner = "attacker";
    else if (defTotalEffective > attTest.roll.total) winner = "defender";
    else winner = "attacker"; // égalité → avantage à l'attaquant
  }

  // -----------------------------------------------------------------------
  // ANIMATION JB2A / SEQUENCER
  // -----------------------------------------------------------------------
  const hit = winner === "attacker";

  if (typeof unicreonPlayAttackAnimation === "function") {
    unicreonPlayAttackAnimation({
      attackType,
      attackerToken,
      targetToken,
      hit
    });
  }

  // -----------------------------------------------------------------------
  // DÉGÂTS + ABSORPTION D'ARMURE
  // -----------------------------------------------------------------------
  let dmg = 0;
  if (winner === "attacker") {
    const txt = damageStr.toLowerCase();
    const maxMatch = txt.match(/max\s*(\d+)/i);
    if (maxMatch) {
      const max = Number(maxMatch[1]) || 0;
      dmg = Math.min(attTest.roll.total, max);
    } else {
      dmg = Number(txt) || 0;
    }
  }

  // Absorption : seulement si l'attaque touche et que l'équipement en fournit
  let absorbed = 0;
  let finalDmg = 0;

  if (winner === "attacker" && dmg > 0) {
    absorbed = Math.max(0, Math.min(dmg, defEquipAbsorption));
    finalDmg = Math.max(0, dmg - absorbed);
  }

  const pvBefore = unicreonGetPV(defender);
  let pvAfter = pvBefore;

  if (winner === "attacker" && finalDmg > 0) {
    pvAfter = await unicreonSetPV(defender, pvBefore - finalDmg);
  }

  // Consommation d’actions : configurable (attaque de sort chère, etc.)
  let actionsCostRaw = atkCfg.actionsCost ?? 1;
  let actionsCost = Number(actionsCostRaw);
  if (!Number.isFinite(actionsCost) || actionsCost < 0) actionsCost = 0;

  if (actionsCost > 0) {
    await spendActions(actor, actionsCost);
  }
  const actionsLeftAfter = getActionsLeft(actor);

  // Cartes de jets (attaque / défense)
  await attTest.roll.toMessage({
    speaker: ChatMessage.getSpeaker({ token: attackerToken ?? null, actor }),
    flavor: `<strong>Jet d'attaque</strong> — ${actor.name} (${unicreonCaracLabel(attCarac)})`
  });

  await defTest.roll.toMessage({
    speaker: ChatMessage.getSpeaker({ token: targetToken ?? null, actor: defender }),
    flavor: `<strong>Jet de défense</strong> — ${defender.name} (${unicreonCaracLabel(defCarac)}${defBuffText})`
  });

  // Texte de résultat
  let resultText;
  if (winner === "attacker" && finalDmg > 0) {
    if (absorbed > 0) {
      resultText =
        `${actor.name} touche ${defender.name} et inflige ` +
        `<strong>${finalDmg} PV</strong> après ` +
        `<strong>${absorbed} PV</strong> absorbés par l'équipement ` +
        `(${pvBefore} → ${pvAfter}).`;
    } else {
      resultText =
        `${actor.name} touche ${defender.name} et inflige ` +
        `<strong>${finalDmg} PV</strong> (${pvBefore} → ${pvAfter}).`;
    }
  } else if (winner === "attacker" && finalDmg === 0 && dmg > 0 && absorbed >= dmg) {
    resultText =
      `${actor.name} aurait infligé <strong>${dmg} PV</strong>, ` +
      `mais l'attaque est <strong>totalement absorbée</strong> par l'équipement de ${defender.name}.`;
  } else if (winner === "attacker" && dmg === 0) {
    resultText = `${actor.name} a l'avantage, mais aucun dégât n'est appliqué.`;
  } else if (winner === "defender") {
    resultText = `${defender.name} se protège efficacement. Aucun dégât.`;
  } else {
    resultText = `Aucun succès clair. À la MJ d’interpréter.`;
  }

  let defenseStanceText = "";
  if (stance) {
    const labelStance = stance.type === "mental"
      ? "Résistance magique"
      : "Résistance physique";

    defenseStanceText = `
      <section class="u-section u-stance">
        <h3>Posture défensive</h3>
        <p>${defender.name} bénéficie de <strong>${labelStance}</strong> pour ce jet de défense (avantage).</p>
        <p>La posture est maintenant <strong>consommée</strong> et n'appliquera plus de bonus jusqu'à ce qu'elle soit réactivée.</p>
      </section>
    `;
  } else {
    defenseStanceText = `
      <section class="u-section u-stance">
        <h3>Posture défensive</h3>
        <p>Aucune posture défensive active n'était en place.</p>
      </section>
    `;
  }

  // Section détaillant l'effet de l'équipement défensif
  let defenseEquipText = "";
  if (equipDefense.items.length > 0) {
    const lines = equipDefense.items.map(e =>
      `<li>${e.item.name} : bonus ${e.bonus || 0}, absorption ${e.absorption || 0} PV</li>`
    ).join("");

    defenseEquipText = `
      <section class="u-section u-equip">
        <h3>Équipement défensif</h3>
        <p>Bonus total au jet de défense : <strong>+${defEquipBonus}</strong>
           (jet ${defTotalBase} → ${defTotalEffective}).</p>
        <p>Absorption totale : <strong>${defEquipAbsorption} PV</strong>.</p>
        <ul>${lines}</ul>
      </section>
    `;
  }

  const html = `
<div class="unicreon-attack-card">

  <header class="u-header">
    <h2>Passe d’armes</h2>
    <div class="u-sub">
      ${actor.name} utilise <strong>${item.name}</strong> contre ${defender.name}
    </div>
  </header>

  <section class="u-section">
    <h3>Jet d’attaque</h3>
    <p><strong>${actor.name}</strong> — ${unicreonCaracLabel(attCarac)} (d${attTest.faces}, ${attTest.mode})</p>
    <p>Diff : <strong>${attTest.diff}</strong> — Jet : <strong>${attTest.roll.total}</strong>
       → <span class="u-${attTest.success ? "ok" : "fail"}">
         ${attTest.success ? "Succès" : "Échec"}
       </span> (PK : ${pkA})
    </p>
  </section>

  <section class="u-section">
    <h3>Jet de défense</h3>
    <p><strong>${defender.name}</strong> — ${unicreonCaracLabel(defCarac)} (d${defTest.faces}, ${defTest.mode}${defBuffText})</p>
    <p>Diff : <strong>${defTest.diff}</strong> — Jet : <strong>${defTotalBase}</strong>
       ${defEquipBonus ? `( +${defEquipBonus} équipement = <strong>${defTotalEffective}</strong> )` : ""}
       → <span class="u-${defSuccess ? "ok" : "fail"}">
         ${defSuccess ? "Succès" : "Échec"}
       </span> (PK : ${pkD})
    </p>
  </section>

  <section class="u-section u-result">
    <h3>Résultat</h3>
    <p>${resultText}</p>
  </section>

  ${defenseStanceText}
  ${defenseEquipText}

  <footer class="u-footer">
    Actions restantes pour <strong>${actor.name}</strong> : ${actionsLeftAfter}
  </footer>

</div>
`;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token: attackerToken ?? null, actor }),
    content: html,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });
}

// ============================================================================
// Helper : appliquer / enlever un statut de token sur tous les tokens d'un acteur
// ============================================================================

async function unicreonSetStatus(actor, key, active, { overlay = false } = {}) {
  if (!actor) return;

  const entry = unicreonFindStatusEntry(key);
  if (!entry) {
    console.warn(`Unicreon | statut introuvable pour "${key}" (label: ${UNICREON_STATUS_LABELS[key]})`);
    return;
  }

  const statusId = entry.id || entry.icon;
  if (!statusId) return;

  return unicreonSetStatusOnActor(actor, statusId, active, { overlay });
}

async function unicreonSetStatusOnActor(actor, statusId, active, { overlay = false } = {}) {
  if (!actor) return;

  const options = { overlay };
  if (typeof active === "boolean") options.active = !!active;

  // Si l'Actor sait gérer directement les statuts (v12+)
  if (typeof actor.toggleStatusEffect === "function") {
    try {
      await actor.toggleStatusEffect(statusId, options);
      return;
    } catch (err) {
      console.error("Unicreon | actor.toggleStatusEffect a échoué", statusId, err);
    }
  }

  // Fallback : on passe par les tokens actifs
  for (const token of actor.getActiveTokens() ?? []) {
    try {
      if (typeof token.toggleStatusEffect === "function") {
        await token.toggleStatusEffect(statusId, options);
      }
    } catch (err) {
      console.error("Unicreon | Impossible d’appliquer le statut sur un token", statusId, err);
    }
  }
}

// ============================================================================
// UNICREON – DEFENSE ACTIVE (Résistance physique / mentale)
// ============================================================================

const DEFENSE_STANCE_FLAG = "defenseStance";

/**
 * Pose une posture défensive sur le défenseur.
 * type : "physical" ou "mental"
 * mode : "adv" (avantage) ou "normal"
 */
async function setDefenseStance({ defender, attacker, type = "physical", mode = "adv", uses = 1 }) {
  if (!defender) return null;

  const payload = {
    type,                        // "physical" | "mental"
    mode,                        // "adv" pour avantage
    uses: Math.max(1, Number(uses) || 1),
    vsActorId: attacker?.id || null
  };

  await defender.setFlag("unicreon", DEFENSE_STANCE_FLAG, payload);

  // Icône visuelle sur les tokens
  const statusKey = type === "mental" ? "defenseMental" : "defensePhysical";
  await unicreonSetStatus(defender, statusKey, true, { overlay: false });

  return payload;
}

/**
 * Consomme la posture défensive SI elle s’applique à cette attaque.
 * - si vsActorId est défini et ne matche pas l’attaquant → ignorée
 * - type "physical" ne sert que contre les attaques physiques (melee/ranged)
 */
async function consumeDefenseStance({ defender, attacker, attackType = "melee" }) {
  if (!defender) return null;

  const data = defender.getFlag("unicreon", DEFENSE_STANCE_FLAG);
  if (!data) return null;

  // ciblage : seulement contre l’attaquant désigné
  if (data.vsActorId && attacker && data.vsActorId !== attacker.id) {
    return null;
  }

  // type "physical" : seulement contre attaques physiques (melee / ranged)
  if (data.type === "physical") {
    const t = attackType || "melee";
    if (!["melee", "ranged"].includes(t)) return null;
  }

  // type "mental" : seulement contre les attaques de sort
  if (data.type === "mental") {
    const t = attackType || "melee";
    if (t !== "spell") return null;
  }

  // Stance consommée → on retire le flag + l’icône
  await defender.unsetFlag("unicreon", DEFENSE_STANCE_FLAG);

  const statusKey = data.type === "mental" ? "defenseMental" : "defensePhysical";
  await unicreonSetStatus(defender, statusKey, false, { overlay: false });

  return data;
}

/**
 * Utilisation active d’une compétence de Résistance (mentale / physique).
 * - coûte 1 action
 * - nécessite un token ennemi ciblé (sinon stance valable contre n’importe qui)
 */
async function useDefenseStance(item) {
  const actor = item.actor ?? item.parent;
  if (!actor) {
    ui.notifications.warn("Aucun acteur pour cette compétence.");
    return;
  }

  // Gestion des actions / tour
  const actionsLeft = game.unicreon?.getActionsLeft
    ? game.unicreon.getActionsLeft(actor)
    : 1;

  if (actionsLeft <= 0) {
    ui.notifications.warn(`${actor.name} n'a plus d'action pour ce tour.`);
    return;
  }

  // Détection du type via le nom
  const name = item.name || "";
  const isMental = name.toLowerCase().includes("mentale");
  const type = isMental ? "mental" : "physical";

  // Cible : token ennemi ciblé (facultatif)
  const targets = Array.from(game.user?.targets ?? []);
  const enemyToken = targets[0] || null;
  const enemyActor = enemyToken?.actor || null;

  const stance = await setDefenseStance({
    defender: actor,
    attacker: enemyActor,
    type,
    mode: "adv",
    uses: 1
  });

  // Consomme 1 action
  if (game.unicreon?.spendActions) {
    await game.unicreon.spendActions(actor, 1);
  }

  const remaining = game.unicreon?.getActionsLeft
    ? game.unicreon.getActionsLeft(actor)
    : "—";

  const cibleTxt = enemyActor
    ? `contre <strong>${enemyActor.name}</strong>`
    : "contre la prochaine attaque pertinente";

  const label = stance.type === "mental"
    ? "Résistance mentale (Pouvoir)"
    : "Résistance physique (Puissance)";

  const card = `
    <div class="unicreon-card">
      <h2>${actor.name} se met en posture défensive</h2>
      <p><strong>${label}</strong></p>
      <p>La prochaine défense ${cibleTxt} sera exécutée avec
         <strong>avantage</strong> et en utilisant
         <strong>${stance.type === "mental" ? "Pouvoir" : "Puissance"}</strong>.</p>
      <p>Actions restantes ce tour : <strong>${remaining}</strong></p>
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: card
  });
}

// ============================================================================
// UNICREON – Utilisation d'un sort / pouvoir / potion
// ============================================================================

if (!game.unicreon) game.unicreon = {};

game.unicreon.useMagicItem = async function (actor, item) {
  if (!actor || !item) {
    return ui.notifications.warn("Pas d'acteur / d'objet sélectionné.");
  }

  const sysA = actor.system ?? {};
  const sysI = item.system ?? {};
  const flags = actor.flags?.unicreon ?? {};

  // -------------------------------------------------------------------------
  // 1) Coûts (d'après tes sheets d'item)
  //    - Coût points de sorts  : system.costSpellPoints
  //    - Coût en actions       : system.costActions
  // -------------------------------------------------------------------------

  const costPS = Number(sysI.costSpellPoints ?? 0);
  const costActions = Number(sysI.costActions ?? 0);

  const inCombat = !!game.combat?.started;

  // -------------------------------------------------------------------------
  // 2) Ressources de l'acteur (mapping sur TA feuille)
  //
  //  - Points de sorts : system.pools.ps.value / max
  //  - Actions         : flags.unicreon.actionsLeft / actionsTotal
  // -------------------------------------------------------------------------

  const curPS = Number(sysA.pools?.ps?.value ?? 0);
  const maxPS = Number(sysA.pools?.ps?.max ?? 0);

  const curAct = Number(flags.actionsLeft ?? 0);
  const totalAct = Number(flags.actionsTotal ?? 0);

  // Vérif points de sorts
  if (costPS > 0 && curPS < costPS) {
    return ui.notifications.warn(`${actor.name} n'a pas assez de points de sorts.`);
  }

  // Vérif actions (seulement en combat)
  if (inCombat && costActions > 0 && curAct < costActions) {
    return ui.notifications.warn(`${actor.name} n'a plus assez d'actions ce tour.`);
  }

  // -------------------------------------------------------------------------
  // 3) Détection du type de sort
  // -------------------------------------------------------------------------

  const effectTag = (sysI.effectTag || "").trim();

  // On considère "[-X PV]" comme dégâts ; tu peux en rajouter si tu veux
  const isOffensif = /\[-\s*\d+\s*PV\]/i.test(effectTag);
  const isHeal =
    /\[\+\s*\d+\s*PV\]/i.test(effectTag) ||
    (/^\[\s*\d+\s*PV\]/i.test(effectTag) && !isOffensif);

  // Stat liée (Pouvoir par défaut)
  const statKey = sysI.stat || "pouvoir";

  // -------------------------------------------------------------------------
  // 4) Résolution : OFFENSIF = passe d’armes, sinon effet direct
  // -------------------------------------------------------------------------

  let rollData = null;
  let effectResult = null;

  if (item.type === "pouvoir" || item.type === "incantation") {
    if (isOffensif) {
      // ----- 4.a) Sort offensif : passe d'armes générique -----
      if (!game.unicreon.resolveAttackFromItem) {
        console.warn("resolveAttackFromItem manquant, on applique juste les tags.");
        if (game.unicreon.applyEffectTag && effectTag) {
          effectResult = await game.unicreon.applyEffectTag({
            actor,
            item,
            tag: effectTag
          });
        }
      } else {
        rollData = await game.unicreon.resolveAttackFromItem({
          actor,
          item,
          isSpell: true,   // pour que resolve sache que c'est un sort
          statKey          // Pouvoir / Volonté / etc.
        });
      }
    } else {
      // ----- 4.b) Sort utilitaire / soin -----
      if (game.unicreon.applyEffectTag && effectTag) {
        effectResult = await game.unicreon.applyEffectTag({
          actor,
          item,
          tag: effectTag
        });
      }
    }
  } else if (item.type === "potion") {
    // ----- 4.c) Potions -----
    if (game.unicreon.applyEffectTag && effectTag) {
      effectResult = await game.unicreon.applyEffectTag({
        actor,
        item,
        tag: effectTag
      });
    }
  }

  // -------------------------------------------------------------------------
  // 5) Dépense des ressources
  //    - PS : system.pools.ps.value
  //    - Actions : flags.unicreon.actionsLeft
  //      (uniquement en combat → hors combat, on ne touche pas aux actions)
  // -------------------------------------------------------------------------

  const updates = {};

  if (costPS > 0) {
    const newPS = Math.max(0, curPS - costPS);
    foundry.utils.setProperty(updates, "system.pools.ps.value", newPS);
  }

  // Hors combat : on ne touche PAS aux actions
  if (inCombat && costActions > 0) {
    const newAct = Math.max(0, curAct - costActions);
    await actor.setFlag("unicreon", "actionsLeft", newAct);
  }

  if (Object.keys(updates).length) {
    await actor.update(updates);
  }

  // -------------------------------------------------------------------------
  // 6) Message de chat propre
  // -------------------------------------------------------------------------

  const parts = [];

  parts.push(`<strong>${actor.name}</strong> utilise <strong>${item.name}</strong>.`);

  const costBits = [];
  if (costPS > 0) costBits.push(`${costPS} PS`);
  if (inCombat && costActions > 0) costBits.push(`${costActions} action(s)`);
  if (costBits.length) {
    parts.push(`<em>Coût :</em> ${costBits.join(" + ")}.`);
  }

  // Si resolveAttackFromItem renvoie déjà du HTML de jet, on l'insère
  if (rollData?.html) {
    parts.push(rollData.html);
  } else if (rollData?.roll) {
    parts.push(`<p>Jet : ${rollData.roll.total}</p>`);
  }

  // Petit rappel du tag si rien ne l’a géré automatiquement
  if (effectTag && !effectResult?.hasEffects && !rollData?.handledEffects) {
    parts.push(
      `<p style="font-size:11px;color:#666;">Tag d'effet : <code>${effectTag}</code> (à gérer manuellement si besoin).</p>`
    );
  }

  ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="unicreon-chat-card">${parts.join("<br/>")}</div>`
  });

  return { rollData, effectResult };
};

// ---------------------------------------------------------------------------
// READY : expose l’API dans game.unicreon
// ---------------------------------------------------------------------------
Hooks.once("ready", () => {
  const api = {
    // Effets / objets
    parseEffectTag,
    parsePassiveTag,
    applyEffect,
    useItem,

    // Compétences
    rollCompetence,

    // Actions par tour
    getActionsLeft,
    setActionsLeft,
    spendActions,

    // Mouvement
    getMoveLeft,
    getMoveMax,
    setMove,
    resetMoveForActor,
    spendMove,

    // Défense active
    setDefenseStance,
    consumeDefenseStance,
    useDefenseStance,

    // Passe d'armes générique
    resolveAttackFromItem,

    // config
    actionsPerTurn: UNICREON_ACTIONS_PER_TURN
  };

  game.unicreon = Object.assign(game.unicreon || {}, api);
  console.log("Unicreon | API exposée :", game.unicreon);
});
