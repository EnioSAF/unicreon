// systems/unicreon/module/sheets/actor-sheet.js
// Fiche d'acteur Unicreon avec onglets : Aperçu / Compétences / Magie / Équipement
// + gestion des effets (buffs / débuffs) avec bonus/malus affichés

// ---------------------------------------------------------------------------
// Actor Unicreon : calcule les bonus/malus depuis system.effects
// ---------------------------------------------------------------------------

class UnicreonActor extends Actor {
  prepareDerivedData() {
    super.prepareDerivedData();

    const sys = this.system ?? {};
    const effects = Array.isArray(sys.effects) ? sys.effects : [];

    // -----------------------------
    // 1) Bonus / malus numériques
    // -----------------------------
    const caracBonusValues = {}; // ex: { puissance: +1, agilite: -2 }
    const poolBonusValues = {};  // ex: { "pv.max": +3, "pk.max": -1 }

    for (const eff of effects) {
      if (!eff) continue;

      // Si tour restant > 0 → actif, si 0 → permanent, si < 0 → ignoré
      const turns = Number(eff.remainingTurns ?? 0);
      if (turns < 0) continue;

      const target = eff.target;  // "carac" ou "pool"
      const key = eff.key;        // ex: "puissance" ou "pv.max"
      const value = Number(eff.value ?? 0);
      if (!target || !key || !value) continue; // pas de valeur → juste texte

      if (target === "carac") {
        caracBonusValues[key] = (caracBonusValues[key] || 0) + value;
      } else if (target === "pool") {
        poolBonusValues[key] = (poolBonusValues[key] || 0) + value;
      }
    }

    // Effets PASSIFS d'objets équipés
    // Exemple de syntaxes acceptées dans "Effet passif (quand équipé)" :
    //   [2 PV]            ou  [PV 2]
    //   [+1 agilite]      ou  [agilite +1]
    //   [-1 puissance]    ou  [puissance -1]
    const parsePassiveTag = (tag) => {
      if (!tag) return null;

      const raw = String(tag);
      const m = raw.match(/\[([^\]]+)\]/); // on prend juste le premier [ ... ]
      if (!m) return null;

      let inside = m[1].trim().toLowerCase();
      inside = inside.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // vire les accents

      let value, label;

      // Forme 1 : "+1 pouvoir" / "2 pv"
      let m1 = inside.match(/^([+\-]?\d+)\s+(.+)$/);
      if (m1) {
        value = Number(m1[1]);
        label = m1[2].trim();
      } else {
        // Forme 2 : "pouvoir +1" / "pv 2"
        let m2 = inside.match(/^(.+?)\s+([+\-]?\d+)$/);
        if (!m2) return null;
        label = m2[1].trim();
        value = Number(m2[2]);
      }

      if (!value) return null;

      // Normalisation label
      if (label === "pv" || label === "pv max") {
        return { target: "pool", key: "pv.max", value };
      }

      const caracMap = {
        puissance: "puissance",
        agilite: "agilite",
        perception: "perception",
        volonte: "volonte",
        pouvoir: "pouvoir"
      };

      if (caracMap[label]) {
        return { target: "carac", key: caracMap[label], value };
      }

      return null;
    };

    // On parcourt les items équipés
    for (const item of this.items) {
      const sysItem = item.system ?? {};

      // 1) l'objet doit être équipable + équipé
      if (!sysItem.equippable || !sysItem.equipped) continue;

      // 2) on accepte plusieurs noms possibles au cas où
      const rawPassive =
        sysItem.passiveTag ??
        sysItem.passiveEffect ??
        sysItem.passive ??
        sysItem.effectPassive ??
        "";

      if (!rawPassive) continue;

      const eff = parsePassiveTag(rawPassive);
      if (!eff) continue;

      if (eff.target === "carac") {
        caracBonusValues[eff.key] = (caracBonusValues[eff.key] || 0) + eff.value;
      } else if (eff.target === "pool") {
        poolBonusValues[eff.key] = (poolBonusValues[eff.key] || 0) + eff.value;
      }
    }

    // S'assurer que chaque carac a AU MOINS un bonus 0
    const allCaracs = ["puissance", "agilite", "perception", "volonte", "pouvoir"];
    for (const k of allCaracs) {
      if (!Object.prototype.hasOwnProperty.call(caracBonusValues, k)) {
        caracBonusValues[k] = 0;
      }
    }

    const caracMods = {};
    for (const [k, v] of Object.entries(caracBonusValues)) {
      if (!v) continue;
      caracMods[k] = {
        value: v,
        text: (v > 0 ? "+" : "") + v,
        cssClass: v > 0 ? "positive" : "negative"
      };
    }

    const poolMods = {};
    for (const [k, v] of Object.entries(poolBonusValues)) {
      if (!v) continue;
      poolMods[k] = {
        value: v,
        text: (v > 0 ? "+" : "") + v,
        cssClass: v > 0 ? "positive" : "negative"
      };
    }

    sys.derived = sys.derived || {};
    sys.derived.caracBonusValues = caracBonusValues;
    sys.derived.poolBonusValues = poolBonusValues;
    sys.derived.caracMods = caracMods;
    sys.derived.poolMods = poolMods;

    // -----------------------------
    // 2) Charge / capacité en PE
    // -----------------------------
    // Règle simple :
    // - chaque objet utilise `system.encumbrance` PE
    // - les sacs & co donnent de la capacité via `system.capacityPe`
    // - un perso a une base configurable dans system.carry.base (10 par défaut)

    const items = this.items?.contents ?? this.items ?? [];
    let usedPe = 0;
    let bonusCapacity = 0;

    for (const it of items) {
      if (!it) continue;

      // On ignore les trucs "conceptuels"
      if (["race", "metier", "competence"].includes(it.type)) continue;

      const isys = it.system ?? {};
      const enc = Number(isys.encumbrance ?? 0);
      const cap = Number(isys.capacityPe ?? 0);

      if (!isNaN(enc) && enc > 0) {
        usedPe += enc;
      }
      if (!isNaN(cap) && cap > 0) {
        bonusCapacity += cap;
      }
    }

    // Capacité de base (modifiable dans la fiche)
    const baseCapacity = Number(sys.carry?.base ?? 10);

    const maxPe = Math.max(0, baseCapacity + bonusCapacity);
    const percent = maxPe > 0 ? Math.round(Math.min(100, (usedPe / maxPe) * 100)) : 0;
    const overloaded = maxPe > 0 && usedPe > maxPe;

    sys.derived.carry = {
      used: usedPe,
      max: maxPe,
      base: baseCapacity,
      bonus: bonusCapacity,
      free: Math.max(0, maxPe - usedPe),
      overload: Math.max(0, usedPe - maxPe),
      percent,
      cssClass: overloaded ? "over" : "ok",
      overloaded
    };
  }
}


// ---------------------------------------------------------------------------
// Sheet d'acteur
// ---------------------------------------------------------------------------

export class UnicreonActorSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["unicreon", "sheet", "actor", "unicreon-actor"],
      width: 780,
      height: 820,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "overview" }]
    });
  }

  get template() {
    return `systems/${game.system.id}/templates/actor/actor-sheet.hbs`;
  }

  getData(options = {}) {
    const data = super.getData(options);
    const actor = this.actor;
    const sys = actor.system ?? {};
    const items = actor.items ?? [];

    // ------------------------------------------------------------
    // 0) Rendre les FLAGS accessibles au template
    // ------------------------------------------------------------
    // Foundry ne met pas forcément actor.flags sur "data" pour toi,
    // donc on l'ajoute manuellement et on s'assure que
    // flags.unicreon existe avec des valeurs par défaut.
    const rawFlags = actor.flags ?? {};
    const unicreonFlags = rawFlags.unicreon ?? {};

    data.flags = data.flags ?? {};
    data.flags.unicreon = {
      story: unicreonFlags.story ?? "",
      race: unicreonFlags.race ?? "",
      metier: unicreonFlags.metier ?? ""
    };

    // ------------------------------------------------------------
    // 1) Caracs de base Unicreon
    // ------------------------------------------------------------
    data.caracKeys = [
      { key: "puissance", label: "Puissance" },
      { key: "agilite", label: "Agilité" },
      { key: "perception", label: "Perception" },
      { key: "volonte", label: "Volonté" },
      { key: "pouvoir", label: "Pouvoir" }
    ];

    data.attributes = sys.attributes ?? {};
    data.pools = sys.pools ?? {};

    // ------------------------------------------------------------
    // 2) Barre d’XP / niveau (visuel)
    // ------------------------------------------------------------
    const progress = sys.progress ?? {};
    const xp = Number(progress.xp ?? 0);
    const xpNext = Number(progress.xpNext ?? 100);
    const level = Number(progress.level ?? 1);
    const xpPct = xpNext > 0
      ? Math.max(0, Math.min(100, Math.round((xp / xpNext) * 100)))
      : 0;

    data.progress = { level, xp, xpNext, xpPercent: xpPct };

    const magicTypes = ["pouvoir", "incantation", "rituel", "sort"];
    const gearTypes = ["arme", "armure", "objet", "potion"];

    // Groupes d'objets pour les onglets
    const sorted = [...items].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    data.itemGroups = {
      race: sorted.filter(i => i.type === "race"),
      metier: sorted.filter(i => i.type === "metier"),
      competences: sorted.filter(i => i.type === "competence"),
      magic: sorted.filter(i => magicTypes.includes(i.type)),
      gearItems: sorted.filter(i => gearTypes.includes(i.type))
    };

    // ------------------------------------------------------------
    // 3) Effets manuels stockés sur l'acteur : system.effects
    // ------------------------------------------------------------
    const effects = Array.isArray(sys.effects) ? sys.effects : [];

    const caracLabels = {
      puissance: "Puissance",
      agilite: "Agilité",
      perception: "Perception",
      volonte: "Volonté",
      pouvoir: "Pouvoir"
    };

    data.activeEffects = effects.map(eff => {
      const label = eff.label || "(effet sans nom)";
      const type = eff.type || "buff";
      const isBuff = type === "buff";
      const isDebuff = type === "debuff";
      const typeLabel = isBuff ? "Buff" : (isDebuff ? "Débuff" : type);

      const turns = Number(eff.remainingTurns ?? 0);
      let durationLabel;
      if (turns <= 0) durationLabel = "Permanent";
      else if (turns === 1) durationLabel = "1 tour";
      else durationLabel = `${turns} tours`;

      let targetLabel = "";
      if (eff.target === "carac" && eff.key) {
        targetLabel = caracLabels[eff.key] || eff.key;
      } else if (eff.target === "pool") {
        if (eff.key === "pv.max") targetLabel = "PV max";
        else if (eff.key === "pk.max") targetLabel = "PK max";
        else if (eff.key === "ps.max") targetLabel = "PS max";
        else targetLabel = eff.key || "";
      }

      const value = Number(eff.value ?? 0);
      const hasValue = !!value;
      const modText = hasValue ? ((value > 0 ? "+" : "") + value) : "";

      return {
        label,
        type,
        typeLabel,
        isBuff,
        isDebuff,
        description: eff.description || "",
        remainingTurns: isNaN(turns) ? 0 : turns,
        durationLabel,
        targetLabel,
        hasValue,
        modText
      };
    });

    // ------------------------------------------------------------
    // 4) Bonus/malus numériques calculés par l’Actor
    // ------------------------------------------------------------
    const derived = sys.derived ?? {};
    data.caracMods = derived.caracMods ?? {};
    data.poolMods = derived.poolMods ?? {};

    // ------------------------------------------------------------
    // 5) PV effectifs (base + bonus d’effets sur "pv.max")
    // ------------------------------------------------------------
    const pools = sys.pools ?? {};
    const pvData = pools.pv ?? {};

    const baseMaxRaw = Number(pvData.max ?? 0);
    let baseVal = Number(pvData.value ?? 0);
    const baseMax = Number.isFinite(baseMaxRaw) && baseMaxRaw > 0 ? baseMaxRaw : 0;

    if (!Number.isFinite(baseVal)) baseVal = 0;
    if (baseVal < 0) baseVal = 0;
    if (baseVal > baseMax) baseVal = baseMax;

    const bonusMap = derived.poolBonusValues ?? {};
    const bonus = Number(bonusMap["pv.max"] ?? 0) || 0;

    const effectiveMax = baseMax + bonus;
    let effectiveVal = baseVal + bonus;

    if (!Number.isFinite(effectiveVal)) effectiveVal = 0;
    if (effectiveVal < 0) effectiveVal = 0;
    if (effectiveVal > effectiveMax) effectiveVal = effectiveMax;

    let pvClass = "";
    if (bonus > 0) pvClass = "positive";
    else if (bonus < 0) pvClass = "negative";

    data.pvEffective = {
      baseMax,
      bonus,
      max: effectiveMax,
      value: effectiveVal,
      cssClass: pvClass
    };

    // ------------------------------------------------------------
    // 6) Charge / capacité (calculée dans prepareDerivedData)
    // ------------------------------------------------------------
    const derivedCarry = sys.derived?.carry ?? {};
    const baseCapacity = Number(sys.carry?.base ?? 10);

    data.carry = {
      used: derivedCarry.used ?? 0,
      max: derivedCarry.max ?? baseCapacity,
      base: derivedCarry.base ?? baseCapacity,
      bonus: derivedCarry.bonus ?? 0,
      free: derivedCarry.free ?? 0,
      overload: derivedCarry.overload ?? 0,
      percent: derivedCarry.percent ?? 0,
      cssClass: derivedCarry.cssClass ?? "ok",
      overloaded: !!derivedCarry.overloaded
    };

    // ------------------------------------------------------------
    // 7) Mouvement (PM) + Actions (pour la fiche)
    // ------------------------------------------------------------
    const pmPool = sys.pools?.pm ?? {};
    let pmValue = Number(pmPool.value ?? 0);
    let pmMax = Number(pmPool.max ?? 0);

    if (!Number.isFinite(pmValue) || pmValue < 0) pmValue = 0;
    if (!Number.isFinite(pmMax) || pmMax < 0) pmMax = 0;
    if (pmValue > pmMax) pmValue = pmMax;

    data.pm = {
      value: pmValue,
      max: pmMax
    };

    // ---- Actions ----
    // On passe par les flags Unicreon pour stocker les valeurs éditables
    const uFlags = actor.flags?.unicreon ?? {};

    const defaultActions =
      Number(game.unicreon?.actionsPerTurn ?? 2) || 2;

    // Total d’actions par tour (éditable dans la fiche)
    let totalActions = Number(uFlags.actionsTotal ?? defaultActions);
    if (!Number.isFinite(totalActions) || totalActions < 1) {
      totalActions = 1;
    }

    // Actions restantes (éditables + clampées entre 0 et total)
    let actionsLeft = Number(uFlags.actionsLeft ?? totalActions);
    if (!Number.isFinite(actionsLeft)) actionsLeft = totalActions;
    if (actionsLeft < 0) actionsLeft = 0;
    if (actionsLeft > totalActions) actionsLeft = totalActions;

    data.actions = {
      left: actionsLeft,
      total: totalActions
    };

    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;

    // Bouton de test générique
    html.on("click", "[data-action='roll-test']", this._onRollTest.bind(this));

    // Ouvrir un item
    html.on("click", ".item-open", this._onItemOpen.bind(this));

    // Jet de compétence (onglet Compétences)
    html.on("click", ".item-roll-competence", this._onItemRollCompetence.bind(this));

    // Utiliser un pouvoir / rituel / objet magique
    html.on("click", ".item-use-magic", this._onItemUseMagic.bind(this));

    // Suppression d'item
    html.on("click", "[data-action='item-delete']", this._onItemDelete.bind(this));

    // Effets manuels
    html.on("click", "[data-action='effect-add']", this._onEffectAdd.bind(this));
    html.on("click", "[data-action='effect-delete']", this._onEffectDelete.bind(this));
    html.on("click", "[data-action='effect-tick']", this._onEffectTick.bind(this));

    // PV courant : clamp 0..(base + bonus) quand on modifie la valeur
    html.on(
      "change",
      "input[name='system.pools.pv.value']",
      this._onPvValueChange.bind(this)
    );

    // PV max de base : clamp + recalc de la valeur dans la nouvelle limite
    html.on(
      "change",
      "input[name='system.pools.pv.max']",
      this._onPvMaxChange.bind(this)
    );

    // PM courant : clamp 0..pm.max
    html.on(
      "change",
      "input[name='system.pools.pm.value']",
      this._onPmValueChange.bind(this)
    );

    // PM max : clamp >= 0 et ajuste la valeur si besoin
    html.on(
      "change",
      "input[name='system.pools.pm.max']",
      this._onPmMaxChange.bind(this)
    );

    // Actions restantes (stockées en flag)
    html.on(
      "change",
      "input[name='flags.unicreon.actionsLeft']",
      this._onActionsChange.bind(this)
    );

    // (Dé)équiper un objet depuis la fiche
    html.on("click", "[data-action='toggle-equip']", this._onToggleEquip.bind(this));

    // Drag & drop des lignes d'items vers la hotbar / autre feuille
    const root = html[0];
    if (root) {
      root.querySelectorAll(".item-row").forEach(row => {
        row.setAttribute("draggable", "true");
        row.addEventListener("dragstart", this._onDragStart.bind(this));
      });
    }
  }

  // -----------------------------------------------------------------------
  // utilitaires
  // -----------------------------------------------------------------------

  _getItemFromEvent(event) {
    const li = event.currentTarget.closest("[data-item-id]");
    if (!li) return null;
    const id = li.dataset.itemId;
    return this.actor.items.get(id) ?? null;
  }

  /**

  Normalise un "dé" venu du système en vraie formule Roll.
  */
  _normalizeDie(die, fallback = "1d6") {
    if (!die) return fallback;
    let txt = String(die).trim().toLowerCase();

    if (/^\d+$/.test(txt)) return `1d${txt}`; // "6" -> 1d6

    if (/^d\d+$/.test(txt)) return `1${txt}`;  // "d8" -> 1d8
    if (/^\d+d\d+$/.test(txt)) return txt;        // "2d8" -> 2d8

    return fallback;
  }

  // -----------------------------------------------------------------------
  // Drag & drop des items (vers hotbar, autre feuille, etc.)
  // -----------------------------------------------------------------------
  _onDragStart(event) {
    const actor = this.actor;
    if (!actor) return;

    // Event natif ou jQuery → on récupère le DragEvent
    const e = event instanceof DragEvent ? event : event?.originalEvent;
    if (!e || !e.dataTransfer) return;

    const row = e.currentTarget?.closest?.("[data-item-id]");
    if (!row) return;

    const itemId = row.dataset.itemId;
    const item = actor.items.get(itemId);
    if (!item) return;

    // IMPORTANT : item.uuid est déjà du style "Actor.<id>.Item.<id>"
    const dragData = item.toDragData ? item.toDragData() : {
      type: "Item",
      uuid: item.uuid,
      actorId: actor.id,
      itemId: item.id,
      data: item.toObject()
    };

    e.dataTransfer.setData("text/plain", JSON.stringify(dragData));
  }

  // -----------------------------------------------------------------------
  // Gestion des PV : clamp valeur / max en tenant compte des bonus passifs
  // -----------------------------------------------------------------------

  async _onPvValueChange(event) {
    event.preventDefault();

    const actor = this.actor;
    const sys = actor.system ?? {};
    const pools = sys.pools ?? {};
    const pv = pools.pv ?? {};

    const baseMax = Number(pv.max ?? 0) || 0;
    const bonus = Number(sys.derived?.poolBonusValues?.["pv.max"] ?? 0) || 0;
    const effectiveMax = baseMax + bonus;

    // Ce que l'utilisateur vient de taper = PV "effectifs"
    let effectiveVal = Number(event.currentTarget.value || 0);
    if (!Number.isFinite(effectiveVal)) effectiveVal = 0;
    if (effectiveVal < 0) effectiveVal = 0;
    if (effectiveVal > effectiveMax) effectiveVal = effectiveMax;

    // On convertit en PV "de base" (stockés dans le système)
    let baseVal = effectiveVal - bonus;
    if (!Number.isFinite(baseVal)) baseVal = 0;
    if (baseVal < 0) baseVal = 0;
    if (baseVal > baseMax) baseVal = baseMax;

    const currentBase = Number(pv.value ?? 0) || 0;
    if (baseVal === currentBase) return; // rien à faire

    await actor.update({ "system.pools.pv.value": baseVal });
  }

  async _onPvMaxChange(event) {
    event.preventDefault();

    const actor = this.actor;
    const sys = actor.system ?? {};
    const pools = sys.pools ?? {};
    const pv = pools.pv ?? {};

    // Nouveau max de base (case de droite)
    let baseMax = Number(event.currentTarget.value || 0);
    if (!Number.isFinite(baseMax) || baseMax < 0) baseMax = 0;

    // PV de base actuels
    let currentBase = Number(pv.value ?? 0);
    if (!Number.isFinite(currentBase)) currentBase = 0;
    if (currentBase > baseMax) currentBase = baseMax;
    if (currentBase < 0) currentBase = 0;

    await actor.update({
      "system.pools.pv.max": baseMax,
      "system.pools.pv.value": currentBase
    });
  }

  // -----------------------------------------------------------------------
  // Gestion des PM
  // -----------------------------------------------------------------------
  async _onPmValueChange(event) {
    event.preventDefault();

    const actor = this.actor;
    const sys = actor.system ?? {};
    const pm = sys.pools?.pm ?? {};

    const max = Number(pm.max ?? 0) || 0;
    let value = Number(event.currentTarget.value || 0);

    if (!Number.isFinite(value) || value < 0) value = 0;
    if (value > max) value = max;

    const current = Number(pm.value ?? 0) || 0;
    if (value === current) return;

    await actor.update({ "system.pools.pm.value": value });
  }

  async _onPmMaxChange(event) {
    event.preventDefault();

    const actor = this.actor;
    const sys = actor.system ?? {};
    const pm = sys.pools?.pm ?? {};

    let max = Number(event.currentTarget.value || 0);
    if (!Number.isFinite(max) || max < 0) max = 0;

    let value = Number(pm.value ?? 0);
    if (!Number.isFinite(value) || value < 0) value = 0;
    if (value > max) value = max;

    await actor.update({
      "system.pools.pm.max": max,
      "system.pools.pm.value": value
    });
  }

  // -----------------------------------------------------------------------
  // Gestion des actions (flags.unicreon.actionsLeft)
  // -----------------------------------------------------------------------
  async _onActionsChange(event) {
    event.preventDefault();

    const actor = this.actor;
    let value = Number(event.currentTarget.value || 0);

    const max = Number(game.unicreon?.actionsPerTurn ?? 2) || 2;

    if (!Number.isFinite(value) || value < 0) value = 0;
    if (value > max) value = max;

    await actor.setFlag("unicreon", "actionsLeft", value);

    // petit refresh pour que la valeur clampée s'affiche direct
    this.render(false);
  }

  // -----------------------------------------------------------------------
  // ouverture / suppression d’item
  // -----------------------------------------------------------------------

  async _onItemOpen(event) {
    event.preventDefault();
    const item = this._getItemFromEvent(event);
    if (!item) return;
    return item.sheet.render(true);
  }

  async _onItemDelete(event) {
    event.preventDefault();
    const item = this._getItemFromEvent(event);
    if (!item) return;
    await this.actor.deleteEmbeddedDocuments("Item", [item.id]);
  }

  // -----------------------------------------------------------------------
  // Gestion des effets manuels (buffs / débuffs)
  // -----------------------------------------------------------------------

  async _onEffectAdd(event) {
    event.preventDefault();

    const content = `
  <form>
    <div class="form-group">
      <label>Nom de l'effet</label>
      <input type="text" name="label" placeholder="Bénédiction, Poison, Fatigue..." />
    </div>

    <div class="form-group">
      <label>Type</label>
      <select name="type">
        <option value="buff">Buff</option>
        <option value="debuff">Débuff</option>
      </select>
    </div>

    <div class="form-group">
      <label>Tours restants</label>
      <input type="number" name="remainingTurns" value="0" min="0" />
      <p class="hint">0 = permanent (durée illimitée)</p>
    </div>

    <hr/>

    <div class="form-group">
      <label>Cible (optionnel)</label>
      <select name="target">
        <option value="">(Aucun effet chiffré)</option>
        <option value="carac">Caractéristique</option>
        <option value="pv-max">PV max</option>
        <option value="pk-max">PK max</option>
      </select>
    </div>

    <div class="form-group">
      <label>Caractéristique (si cible = Carac)</label>
      <select name="caracKey">
        <option value="">(aucune)</option>
        <option value="puissance">Puissance</option>
        <option value="agilite">Agilité</option>
        <option value="perception">Perception</option>
        <option value="volonte">Volonté</option>
        <option value="pouvoir">Pouvoir</option>
      </select>
    </div>

    <div class="form-group">
      <label>Valeur (+/-)</label>
      <input type="number" name="value" value="0" />
      <p class="hint">Ex : +1, -2… 0 = pas de modificateur chiffré.</p>
    </div>

    <div class="form-group">
      <label>Notes</label>
      <textarea name="description" rows="3" placeholder="Effet en jeu, bonus/malus, conditions..."></textarea>
    </div>
  </form>
`;

    const result = await Dialog.prompt({
      title: `Ajouter un effet à ${this.actor.name}`,
      content,
      label: "Ajouter",
      callback: html => {
        const targetRaw = html.find("[name='target']").val();
        let target = "";
        let key = "";
        if (targetRaw === "carac") {
          target = "carac";
          key = html.find("[name='caracKey']").val();
        } else if (targetRaw === "pv-max") {
          target = "pool";
          key = "pv.max";
        } else if (targetRaw === "pk-max") {
          target = "pool";
          key = "pk.max";
        }

        return {
          label: html.find("[name='label']").val()?.trim(),
          type: html.find("[name='type']").val(),
          remainingTurns: Number(html.find("[name='remainingTurns']").val() || 0),
          description: html.find("[name='description']").val()?.trim(),
          target,
          key,
          value: Number(html.find("[name='value']").val() || 0)
        };
      }
    });

    if (!result || !result.label) return;

    const sys = this.actor.system ?? {};
    const effects = Array.isArray(sys.effects) ? [...sys.effects] : [];

    effects.push({
      label: result.label,
      type: result.type || "buff",
      remainingTurns: isNaN(result.remainingTurns) ? 0 : result.remainingTurns,
      description: result.description || "",
      target: result.target || "",
      key: result.key || "",
      value: isNaN(result.value) ? 0 : result.value
    });

    await this.actor.update({ "system.effects": effects });


  }

  async _onEffectDelete(event) {
    event.preventDefault();
    const row = event.currentTarget.closest(".effect-row");
    if (!row) return;

    const index = Number(row.dataset.index);
    if (isNaN(index)) return;

    const sys = this.actor.system ?? {};
    const effects = Array.isArray(sys.effects) ? [...sys.effects] : [];

    if (index < 0 || index >= effects.length) return;

    effects.splice(index, 1);

    await this.actor.update({ "system.effects": effects });


  }

  async _onEffectTick(event) {
    event.preventDefault();
    const row = event.currentTarget.closest(".effect-row");
    if (!row) return;

    const index = Number(row.dataset.index);
    if (isNaN(index)) return;

    const sys = this.actor.system ?? {};
    const effects = Array.isArray(sys.effects) ? [...sys.effects] : [];

    const eff = effects[index];
    if (!eff) return;

    const current = Number(eff.remainingTurns || 0);
    if (current > 0) {
      eff.remainingTurns = current - 1;
      await this.actor.update({ "system.effects": effects });
    }


  }

  // -----------------------------------------------------------------------
  // jet de compétence depuis l’onglet Compétences
  // -----------------------------------------------------------------------
  async _onItemRollCompetence(event) {
    event.preventDefault();

    const item = this._getItemFromEvent(event);
    if (!item) return;

    const name = (item.name || "").toLowerCase();

    // Cas particulier : Résistance physique / mentale
    if (game.unicreon?.useDefenseStance &&
      (name.includes("résistance physique") || name.includes("resistance physique") ||
        name.includes("résistance mentale") || name.includes("resistance mentale"))) {

      // On n'effectue PAS de jet maintenant : on arme juste la posture.
      return game.unicreon.useDefenseStance(item);
    }

    // Sinon : compétence standard
    if (!game.unicreon?.rollCompetence) {
      ui.notifications.warn("Le helper de jet Unicreon n'est pas chargé.");
      return;
    }

    return game.unicreon.rollCompetence(item);
  }

  // -----------------------------------------------------------------------
  // utilisation d’un pouvoir / rituel / objet magique
  // -----------------------------------------------------------------------

  async _onItemUseMagic(event) {
    event.preventDefault();
    const item = this._getItemFromEvent(event);
    if (!item) return;

    // Si tu as déjà game.unicreon.useItem on l’utilise
    if (game.unicreon?.useItem) {
      return game.unicreon.useItem(item);
    }

    // Fallback : juste ouvrir l’item
    return item.sheet.render(true);


  }

  // -----------------------------------------------------------------------
  // Jet Unicreon générique (bouton "Test")
  // -----------------------------------------------------------------------

  async _onRollTest(event) {
    event.preventDefault();

    const sysActor = this.actor.system ?? {};
    const caracOptions = [
      { key: "puissance", label: "Puissance" },
      { key: "agilite", label: "Agilité" },
      { key: "perception", label: "Perception" },
      { key: "volonte", label: "Volonté" },
      { key: "pouvoir", label: "Pouvoir" }
    ];

    let content = `<form>
  <div class="form-group">
    <label>Caractéristique</label>
    <select name="carac">`;
    for (const c of caracOptions) {
      content += `<option value="${c.key}">${c.label}</option>`;
    }
    content += `</select></div>
  <div class="form-group">
    <label>Compétence libre (texte)</label>
    <input type="text" name="skillLabel" placeholder="Optionnel (description)"/>
  </div>
</form>`;

    const result = await Dialog.prompt({
      title: `Test Unicreon — ${this.actor.name}`,
      content,
      label: "Lancer",
      callback: html => ({
        carac: html.find("[name='carac']").val(),
        skillLabel: html.find("[name='skillLabel']").val()
      })
    });

    if (!result) return;

    const sourceAtt = sysActor.attributes ?? {};
    const baseCarac = sourceAtt[result.carac] || "d6";
    const caracDie = this._normalizeDie(baseCarac, "1d6");

    const bonusMap = sysActor.derived?.caracBonusValues ?? {};
    const caracBonus = Number(bonusMap[result.carac] || 0);

    let caracFormula = caracDie;
    if (caracBonus) {
      caracFormula += caracBonus > 0 ? `+${caracBonus}` : `${caracBonus}`;
    }

    const roll = await (new Roll(caracFormula)).roll({ async: true });

    const chatContent = `
  <div class="unicreon-card">
    <h2>Test Unicreon — ${this.actor.name}</h2>
    <p><b>Carac :</b> ${result.carac} (${caracFormula})</p>
    ${result.skillLabel ? `<p><b>Compétence :</b> ${result.skillLabel}</p>` : ""}
    <p><b>Résultat :</b> ${roll.total}</p>
  </div>
`;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: chatContent
    });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: `${this.actor.name} — Test Unicreon`,
      rolls: [roll],
      type: CONST.CHAT_MESSAGE_TYPES.ROLL
    });
  }

  // -----------------------------------------------------------------------
  // (Dé)équiper un objet
  // -----------------------------------------------------------------------
  async _onToggleEquip(event) {
    event.preventDefault();

    const item = this._getItemFromEvent(event);
    if (!item) return;

    const sysItem = item.system ?? {};

    // Si jamais on clique sur un truc pas équipable
    if (!sysItem.equippable) {
      ui.notifications?.warn?.("Cet objet n'est pas équipable.");
      return;
    }

    const current = !!sysItem.equipped;
    await item.update({ "system.equipped": !current });
  }

}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

Hooks.once("init", () => {
  console.log("Unicreon | init Unicreon system");

  CONFIG.Actor.documentClass = UnicreonActor;

  CONFIG.Combat.initiative = {
    formula: "@attributes.agilite + @derived.caracBonusValues.agilite",
    decimals: 0
  };

  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("unicreon", UnicreonActorSheet, {
    types: ["personnage", "pnj"],
    makeDefault: true
  });
});

// Bloqué le déplacement des tokens d’acteurs surchargés

Hooks.on("preUpdateToken", (doc, change) => {
  if (!("x" in change || "y" in change)) return; // pas un déplacement

  const actor = doc.actor;
  if (!actor || actor.type !== "personnage") return;

  const carry = actor.system?.derived?.carry;
  if (!carry || !carry.overloaded) return;

  ui.notifications.warn(
    `${actor.name} est surchargé (${carry.used} / ${carry.max} PE) et ne peut pas se déplacer.`
  );
  return false;
});

// ---------------------------------------------------------------------------
// Raccourcis & jets Unicreon (compétences, pouvoirs, etc.)
// ---------------------------------------------------------------------------

Hooks.once("ready", () => {
  // Namespace propre
  game.unicreon = game.unicreon || {};

  // Petit helper pour normaliser un "dé"
  const normalizeDie = (die, fallback = "1d6") => {
    if (!die) return fallback;
    let txt = String(die).trim().toLowerCase();
    if (/^\d+$/.test(txt)) return `1d${txt}`;   // "6"  -> 1d6
    if (/^d\d+$/.test(txt)) return `1${txt}`;    // "d8" -> 1d8
    if (/^\d+d\d+$/.test(txt)) return txt;        // "2d8"
    return fallback;
  };

  // -------------------------------------------------------------------------
  // Jet de COMPÉTENCE Unicreon (dialogue Normal / Avantage / Désavantage)
  // -------------------------------------------------------------------------
  game.unicreon.rollCompetence = async (item) => {
    const actor = item.actor ?? item.parent;
    if (!actor) {
      ui.notifications.warn("Aucun acteur associé à cette compétence.");
      return;
    }

    const sysItem = item.system ?? {};
    const sysActor = actor.system ?? {};

    // -------------------------------------------------------------
    // (1) AUTO-DETECTION des compétences de Résistance (postures)
    // -------------------------------------------------------------
    const name = (item.name || "").toLowerCase();
    const isDefense =
      name.includes("résistance physique") ||
      name.includes("resistance physique") ||
      name.includes("résistance mentale") ||
      name.includes("resistance mentale");

    if (isDefense && game.unicreon?.useDefenseStance) {
      // → POSE LA POSTURE défensive AVANT de lancer les jets
      await game.unicreon.useDefenseStance(item);
    }

    // -------------------------------------------------------------
    // (2) JET DE CARAC + COMPÉTENCE (comme avant)
    // -------------------------------------------------------------
    const die = sysItem.level || "d6";
    const caracKey = sysItem.caracKey || "puissance";

    const baseCarac = sysActor.attributes?.[caracKey] || "d6";
    const caracDie = normalizeDie(baseCarac, "d6");

    const caracBonus = Number(sysActor.derived?.caracBonusValues?.[caracKey] || 0);
    let caracFormula = caracDie + (caracBonus ? (caracBonus > 0 ? `+${caracBonus}` : `${caracBonus}`) : "");

    const mode = await Dialog.prompt({
      title: `Jet — ${item.name}`,
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

    let skillFormula = mode === "adv"
      ? `2${die}kh1`
      : mode === "disadv"
        ? `2${die}kl1`
        : `1${die}`;

    const rollCarac = await (new Roll(caracFormula)).roll({ async: true });
    const rollSkill = await (new Roll(skillFormula)).roll({ async: true });

    const kept = Math.max(rollCarac.total, rollSkill.total);

    // -------------------------------------------------------------
    // (3) MESSAGE DE CHAT
    // -------------------------------------------------------------
    const card = `
    <div class="unicreon-card">
      <h2>${actor.name} — ${item.name}</h2>
      <p><b>Carac (${caracKey}) :</b> ${caracFormula} → ${rollCarac.total}</p>
      <p><b>Compétence (${die}, ${mode}) :</b> ${rollSkill.total}</p>
      <p><b>Résultat gardé :</b> ${kept}</p>
    </div>
  `;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: card
    });

    await rollCarac.toMessage({ flavor: `${actor.name} — Caractéristique (${caracKey})` });
    await rollSkill.toMessage({ flavor: `${actor.name} — Compétence (${item.name}) (${mode})` });
  };

  // -----------------------------------------------------------------------
  // Drag & drop vers la hotbar : on laisse Foundry créer le macro,
  // mais on crée aussi le nôtre quand le drop vient de la fiche.
  // (le createMacro derrière se charge de corriger les macros par défaut)
  // -----------------------------------------------------------------------
  Hooks.on("hotbarDrop", async (bar, data, slot) => {
    if (data.type !== "Item") return;

    // On essaie quand même de créer un macro clean au passage
    const item = await fromUuid(data.uuid).catch(() => null);
    if (!item) return; // le hook createMacro fera le reste

    const uuid = item.uuid;
    const img = item.img || "icons/svg/dice-target.svg";
    const name = item.name;

    const command = `game.unicreon.runItemMacro("${uuid}");`;

    let macro = game.macros.contents.find(m => m.name === name && m.command === command);
    if (!macro) {
      macro = await Macro.create({
        name,
        type: "script",
        img,
        command,
        flags: { "unicreon.itemMacro": true }
      });
    }

    await game.user.assignHotbarMacro(macro, slot);
    return false;
  });

  // -----------------------------------------------------------------------
  // Fonction appelée quand on clique sur un macro Unicreon
  // → utilisée par la barre rapide
  // -----------------------------------------------------------------------
  game.unicreon.runItemMacro = async (uuid) => {
    const item = await fromUuid(uuid).catch(() => null);
    if (!item) {
      return ui.notifications.warn("Cet objet / cette compétence n'existe plus (supprimé ?).");
    }

    const actor = item.actor ?? item.parent;
    if (!actor) {
      return ui.notifications.warn("Aucun acteur associé à cet objet.");
    }

    const type = item.type;
    const name = item.name || "";
    const lowerName = name.toLowerCase();
    const sysItem = item.system ?? {};

    const magicTypes = ["pouvoir", "incantation", "rituel", "sort", "spell"];
    const isMagic = magicTypes.includes(type);
    const hasAttack = !!sysItem.attack?.enabled;
    const hasEffect = !!sysItem.effectTag || !!sysItem.activeTag;

    // Cas particulier : compétences de Résistance → posture défensive
    const isDefense =
      lowerName.includes("résistance mentale") || lowerName.includes("resistance mentale") ||
      lowerName.includes("résistance physique") || lowerName.includes("resistance physique");

    if (isDefense && game.unicreon?.useDefenseStance) {
      return game.unicreon.useDefenseStance(item);
    }

    // Tout ce qui peut viser quelqu'un → on passe par le helper core
    const canUseWithTarget =
      type === "competence" ||
      isMagic ||
      hasAttack ||
      hasEffect;

    if (canUseWithTarget && game.unicreon?.useWithTarget) {
      let usageKind = "active";

      if (isMagic) {
        usageKind = "spell";      // sorts / pouvoirs
      } else if (hasAttack) {
        usageKind = "attack";     // armes / comp offensives
      } else if (type === "competence") {
        usageKind = "skill";      // compés non offensives
      }

      return game.unicreon.useWithTarget({ item, usageKind });
    }

    // Sinon : objet utilitaire / truc sans effet chiffré
    if (game.unicreon?.useItem && (hasEffect || isMagic)) {
      const usageKind = isMagic ? "spell" : "active";
      return game.unicreon.useItem(item, { usageKind });
    }

    // Et vraiment en dernier recours : ouvrir la fiche
    return item.sheet?.render(true);
  };
});


// ---------------------------------------------------------------------------
// Post-traitement des macros créés par défaut ("Display XXX")
// → On les transforme en vrais macros Unicreon avec le bon icône + runItemMacro
// ---------------------------------------------------------------------------

Hooks.on("createMacro", async (macro, options, userId) => {
  const cmd = macro.command ?? "";

  // On ne touche qu'aux macros auto "Display Truc"
  // qui utilisent Hotbar.toggleDocumentSheet("Actor.xxx.Item.yyy")
  if (!cmd.includes("Hotbar.toggleDocumentSheet(")) return;

  const match = cmd.match(/"([^"]+)"/);
  if (!match) return;

  const uuid = match[1];            // ex: Actor.xxxxx.Item.yyyyy
  if (!uuid.includes(".Item.")) return;

  // On essaie de récupérer l'Item pour choper nom + icône
  const item = await fromUuid(uuid).catch(() => null);
  if (!item) return;

  const img = item.img || macro.img || "icons/svg/dice-target.svg";
  const name = item.name || macro.name || "Action";

  // Nouveau code : passe par notre helper
  const command = `game.unicreon.runItemMacro("${uuid}");`;

  await macro.update({
    name,
    img,
    command
  });
});