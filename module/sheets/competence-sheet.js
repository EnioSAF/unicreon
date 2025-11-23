// systems/unicreon/module/sheets/competence-sheet.js
// Fiche de compétence Unicreon (jets simples + passes d'armes offensives)

export class UnicreonCompetenceSheet extends ItemSheet {
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

    // Bouton "Utiliser la compétence" sur la fiche de l'item
    html.find(".competence-roll").on("click", async ev => {
      ev.preventDefault();

      const item = this.item;
      const actor = item.parent;
      if (!actor) {
        ui.notifications.warn("Cette compétence doit être sur un acteur.");
        return;
      }

      // -------------------------------------------------------------------
      // 1) Compétence offensive -> passe d’armes générique
      // -------------------------------------------------------------------
      const attackCfg = item.system?.attack ?? {};
      const isOffensive = !!attackCfg.enabled;
      const hasAPI = !!(game.unicreon && game.unicreon.resolveAttackFromItem);

      if (isOffensive && hasAPI) {
        const targetToken = Array.from(game.user?.targets ?? [])[0] || null;
        const attackerToken = actor.getActiveTokens()[0] ?? null;

        if (!targetToken) {
          ui.notifications.warn(
            "Vise un token défenseur (Alt + clic) avant d'utiliser cette compétence."
          );
          return;
        }

        await game.unicreon.resolveAttackFromItem({
          actor,
          attackerToken,
          targetToken,
          item
        });

        // On sort : on ne fait PAS le jet simple derrière
        return;
      }

      // -------------------------------------------------------------------
      // 2) Autre cas -> on passe par le roller Unicreon centralisé
      // -------------------------------------------------------------------
      if (game.unicreon?.rollCompetence) {
        return game.unicreon.rollCompetence(item);
      }

      // -------------------------------------------------------------------
      // 3) Fallback ultra simple si l'API n'est pas dispo (sécurité)
      // -------------------------------------------------------------------
      const die = item.system.level || "d6";
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

      const roll = new Roll(formula);
      await roll.evaluate();

      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: `<strong>${label}</strong> (${mode})`
      });
    });
  }
}

// Enregistrer cette sheet seulement pour les "competence".
Hooks.once("init", () => {
  console.log("Unicreon | registering UnicreonCompetenceSheet");

  Items.registerSheet("unicreon", UnicreonCompetenceSheet, {
    types: ["competence"],
    makeDefault: true
  });
});
