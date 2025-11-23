// ============================================================================
// UNICREON – Core système "light"
// - Objets : effets passifs (équipés) + effets actifs (à l’usage)
// - Actions / déplacement par tour
// - Passe d’armes générique à partir d’un item offensif (game.unicreon.resolveAttackFromItem)
// ============================================================================



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



// ---------------------------------------------------------------------------
// UTILISATION D’UN OBJET (actif) : UNICREON.USE
// ---------------------------------------------------------------------------

async function useItem(item) {
  const owner = item.parent;
  if (!owner) {
    return ui.notifications.warn("L'objet doit être dans l'inventaire d'un acteur.");
  }

  const sys = item.system || {};

  // Cible : token ciblé > token contrôlé > porteur lui-même
  const targets = Array.from(game.user?.targets ?? []);
  const targetToken =
    targets[0] ||
    canvas.tokens.controlled[0] ||
    owner.getActiveTokens()[0];

  const targetActor = targetToken?.actor || owner;

  // Coût en PV du sort (si > 0) → payé par le lanceur
  if (item.type === "spell" && sys.costPV > 0) {
    const actorPV = owner.system?.pools?.pv;
    const current = Number(actorPV?.value ?? 0);
    const newVal = Math.max(0, current - Number(sys.costPV));
    await owner.update({ "system.pools.pv.value": newVal });
  }

  const tag =
    sys.effectTag ||      // ancien nom
    sys.unicreonTag ||    // nom possible selon ton template
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
      <p><strong>Cible :</strong> ${targetActor.name}</p>
      <p>${result}</p>
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: owner }),
    content: card
  });
}



// ============================================================================
// UNICREON – ACTIONS PAR TOUR
// ============================================================================

const UNICREON_ACTIONS_PER_TURN = 2;

/** Combien d'actions restent à cet acteur pour CE tour ? */
function getActionsLeft(actor) {
  if (!actor) return 0;
  const current = actor.getFlag("unicreon", "actionsLeft");
  if (current === undefined || current === null) return UNICREON_ACTIONS_PER_TURN;
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
  await setActionsLeft(actor, UNICREON_ACTIONS_PER_TURN);
}

/** Consomme des actions (1 par défaut). Renvoie le nombre restant. */
async function spendActions(actor, count = 1) {
  const before = getActionsLeft(actor);
  const after = Math.max(0, before - Math.max(1, Number(count) || 1));
  await setActionsLeft(actor, after);

  if (after <= 0) {
    ui.notifications.info(`${actor.name} n'a plus d'action pour ce tour.`);
  }
  return after;
}



// ============================================================================
// UNICREON – POINTS DE MOUVEMENT (PM)
// ============================================================================

// Dé = PM max
const MOVE_BY_DIE = {
  4: 3,
  6: 4,
  8: 5,
  10: 6,
  12: 7
};

// Récupérer faces du dé d'Agilité
function getAgilityFaces(actor) {
  const die = actor.system?.attributes?.agilite ?? "d6";
  const m = String(die).match(/d(\d+)/i);
  return m ? Number(m[1]) : 6;
}

// PM max par tour
function getMoveMax(actor) {
  const faces = getAgilityFaces(actor);
  return MOVE_BY_DIE[faces] ?? 4;
}

// Lire PM
function getMoveLeft(actor) {
  return Number(actor.system?.pools?.pm?.value ?? 0);
}

// Fixer PM
async function setMove(actor, value) {
  const max = getMoveMax(actor);
  const clamped = Math.max(0, Math.min(max, Number(value) || 0));
  await actor.update({
    "system.pools.pm.max": max,
    "system.pools.pm.value": clamped
  });
  return clamped;
}

// Reset PM début de tour
async function resetMoveForActor(actor) {
  const max = getMoveMax(actor);
  await actor.update({
    "system.pools.pm.max": max,
    "system.pools.pm.value": max
  });
  return max;
}

// Dépenser PM
async function spendMove(actor, cost) {
  const left = getMoveLeft(actor);
  const remaining = Math.max(0, left - Math.max(0, Number(cost) || 0));
  await actor.update({ "system.pools.pm.value": remaining });
  return remaining;
}



// ============================================================================
// HOOK : CHANGEMENT DE TOUR = reset actions + PM
// ============================================================================

Hooks.on("combatTurnChange", (combat, prior, current) => {
  const turn = current?.turn;
  const combatant = combat.turns[turn];
  if (!combatant) return;

  const actor = combatant.actor;
  if (!actor) return;

  resetActionsForActor(actor);
  resetMoveForActor(actor);
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
// UNICREON – RESOLUTION D'ATTAQUE A PARTIR D'UN ITEM
// ============================================================================

/**
 * Passe d'armes générique à partir d'un item offensif
 *
 * @param {object} params
 * @param {Actor}  params.actor         Attaquant (acteur)
 * @param {Token}  params.attackerToken Token de l'attaquant
 * @param {Token}  params.targetToken   Token de la cible
 * @param {Item}   params.item          Compétence / arme offensive
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

  const attCarac = atkCfg.caracKey || item.system?.caracKey || "puissance";
  let defCarac = atkCfg.defaultDefense || "agilite";
  let difficulty = atkCfg.baseDifficulty ?? 4;
  let damageStr = (atkCfg.damage || "1").toString().trim();
  const usePK = atkCfg.usePK !== false;

  const attackerPK = unicreonGetPK(actor);
  const defenderPK = unicreonGetPK(defender);

  // ---------- Dialogue ----------
  const formData = await Dialog.prompt({
    title: `Passe d'armes : ${actor.name} utilise ${item.name} sur ${defender.name}`,
    label: "Lancer",
    content: `
      <form class="unicreon-attack-from-item">
        <div class="form-group">
          <label>Caractéristique d'attaque</label>
          <input type="text" value="${unicreonCaracLabel(attCarac)}" disabled />
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

  const atkMode = formData.atkMode;
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

  const defTest = await unicreonRollTest({
    actor: defender,
    caracKey: defCarac,
    baseDiff: difficulty,
    pkSpent: pkD,
    mode: "normal",
    label: `Défense (${unicreonCaracLabel(defCarac)})`
  });

  await unicreonSpendPK(actor, pkA);
  await unicreonSpendPK(defender, pkD);

  let winner = null;
  if (attTest.success && !defTest.success) winner = "attacker";
  else if (!attTest.success && defTest.success) winner = "defender";
  else if (attTest.success && defTest.success) {
    if (attTest.roll.total > defTest.roll.total) winner = "attacker";
    else if (defTest.roll.total > attTest.roll.total) winner = "defender";
    else winner = "attacker";
  }

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

  const pvBefore = unicreonGetPV(defender);
  let pvAfter = pvBefore;

  if (winner === "attacker" && dmg > 0) {
    pvAfter = await unicreonSetPV(defender, pvBefore - dmg);
  }

  await spendActions(actor, 1);
  const actionsLeftAfter = getActionsLeft(actor);

  // ------------------------ Cartes de JET individuelles -----------------
  await attTest.roll.toMessage({
    speaker: ChatMessage.getSpeaker({ token: attackerToken ?? null, actor }),
    flavor: `<strong>Jet d'attaque</strong> — ${actor.name} (${unicreonCaracLabel(attCarac)})`
  });

  await defTest.roll.toMessage({
    speaker: ChatMessage.getSpeaker({ token: targetToken ?? null, actor: defender }),
    flavor: `<strong>Jet de défense</strong> — ${defender.name} (${unicreonCaracLabel(defCarac)})`
  });


  // ------------------------ Carte de résultat en HTML propre ----------------

  // ------------------------ Carte de RÉSUMÉ de la passe d'armes ---------

  const resultText =
    winner === "attacker" && dmg > 0
      ? `${actor.name} touche ${defender.name} et inflige <strong>${dmg} PV</strong> (${pvBefore} → ${pvAfter}).`
      : winner === "attacker" && dmg === 0
        ? `${actor.name} a l'avantage, mais aucun dégât n'est appliqué.`
        : winner === "defender"
          ? `${defender.name} se protège efficacement. Aucun dégât.`
          : `Aucun succès clair. À la MJ d’interpréter.`;

  // Carte HTML (tu peux garder la version précédente, ou celle-là)
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
    <p><strong>${defender.name}</strong> — ${unicreonCaracLabel(defCarac)} (d${defTest.faces})</p>
    <p>Diff : <strong>${defTest.diff}</strong> — Jet : <strong>${defTest.roll.total}</strong>
       → <span class="u-${defTest.success ? "ok" : "fail"}">
         ${defTest.success ? "Succès" : "Échec"}
       </span> (PK : ${pkD})
    </p>
  </section>

  <section class="u-section u-result">
    <h3>Résultat</h3>
    <p>${resultText}</p>
  </section>

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

    // Actions par tour
    getActionsLeft,
    setActionsLeft,
    spendActions,

    // Mouvement
    getMoveLeft,
    setMove,
    resetMoveForActor,
    spendMove,

    // Passe d'armes générique
    resolveAttackFromItem
  };

  game.unicreon = Object.assign(game.unicreon || {}, api);
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
