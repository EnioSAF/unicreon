// systems/unicreon/module/sheets/item-sheet.js
// Feuille d'objet Unicreon : gère tous les types d'items (armes, armures, objets,
// potions, incantations, pouvoirs, races, métiers, compétences).

export class UnicreonItemSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["unicreon", "sheet", "item"],
      template: "systems/unicreon/templates/item/item-sheet.hbs",
      width: 620,
      height: 540,
      tabs: [
        {
          navSelector: ".tabs",
          contentSelector: ".sheet-body",
          initial: "props"
        }
      ]
    });
  }

  /** Inject the system data so the template can access system.* directly */
  getData(options = {}) {
    const data = super.getData(options);
    // In Foundry V10+, item.system est déjà présent, mais on sécurise.
    data.system = data.item.system ?? data.system ?? {};
    return data;
  }

  /** Activate listeners for buttons inside the sheet */
  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;

    html.on("click", "[data-action='use-item']", ev => {
      ev.preventDefault();
      // Le système expose une fonction utilitaire optionnelle pour appliquer l'effet
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

// Enregistre la feuille comme feuille d'item par défaut du système.
Hooks.once("init", () => {
  console.log("Unicreon | registering UnicreonItemSheet");
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("unicreon", UnicreonItemSheet, { makeDefault: true });
});
