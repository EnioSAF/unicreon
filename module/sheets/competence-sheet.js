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

    html.find(".competence-roll").on("click", async ev => {
      ev.preventDefault();

      const item = this.item;

      if (!item?.parent) {
        ui.notifications.warn("Cette compétence doit être sur un acteur.");
        return;
      }

      if (game.unicreon?.useWithTarget) {
        // Le core gère : posture défensive, attaque, jet simple...
        return game.unicreon.useWithTarget({ item, usageKind: "competence" });
      }

      // Fallback : ancien comportement
      if (game.unicreon?.rollCompetence) {
        return game.unicreon.rollCompetence(item);
      }

      ui.notifications.warn("Unicreon : aucune logique de compétence trouvée.");
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
