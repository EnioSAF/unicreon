// systems/unicreon/module/sheets/competence-sheet.js
// Fiche de compétence Unicreon (jets avec avantage / désavantage)

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

    html.find(".competence-roll").on("click", async ev => {
      ev.preventDefault();

      const item = this.item;
      const actor = item.parent;
      if (!actor) {
        return ui.notifications.warn("Cette compétence doit être sur un acteur.");
      }

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

      const roll = await (new Roll(formula)).roll({ async: true });

      roll.toMessage({
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
