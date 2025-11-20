// systems/unicreon/module/sheets/item-sheet.js
// Fiche d'objet générique Unicreon : armes, armures, objets, potions, etc.

export class UnicreonItemSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["unicreon", "sheet", "item"],
      template: "systems/unicreon/templates/item/item-sheet.hbs",
      width: 620,
      height: 540,
      tabs: [
        {
          navSelector: ".sheet-tabs",
          contentSelector: ".sheet-body",
          initial: "props"
        }
      ]
    });
  }

  get template() {
    return `systems/${game.system.id}/templates/item/item-sheet.hbs`;
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
    if (!this.isEditable) return;

    html.on("click", "[data-action='use-item']", ev => {
      ev.preventDefault();
      if (game.unicreon?.useItem) {
        game.unicreon.useItem(this.item);
      } else {
        ui.notifications.warn(
          "Unicreon : la fonction 'useItem' n'est pas disponible (module non chargé)."
        );
      }
    });
  }
}

// Enregistre la sheet générique comme défaut pour tous les items,
// sauf ceux qui auront une sheet plus spécifique.
Hooks.once("init", () => {
  console.log("Unicreon | registering UnicreonItemSheet");

  Items.registerSheet("unicreon", UnicreonItemSheet, {
    label: "Fiche d'objet Unicreon",
    makeDefault: true,
    types: [
      "objet",
      "arme",
      "armure",
      "potion",
      "metier",
      "race",
      "rituel",
      "sort",
      "incantation",
      "pouvoir"
      // pas "competence" : la sheet spéciale va prendre ce type.
    ]
  });
});
