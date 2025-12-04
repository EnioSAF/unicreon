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

    // --- Compendiums contenant des Items (pour le select des grants)
    data.packs = Array.from(game.packs).filter(p => p.documentName === "Item");

    // --- Normalisation de grantedItems : on accepte tableau OU objet {0:{},1:{}}
    let grants = data.system.grantedItems;

    if (Array.isArray(grants)) {
      // ok
    } else if (grants && typeof grants === "object") {
      // cas produit par le formulaire : { "0": {...}, "1": {...} }
      grants = Object.values(grants);
    } else {
      grants = [];
    }

    data.system.grantedItems = grants;

    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;

    // --- Bouton "Utiliser cet objet" ---
    html.on("click", "[data-action='use-item']", async ev => {
      ev.preventDefault();

      const item = this.item;
      const actor = item.parent;

      if (!actor) {
        ui.notifications.warn("L'objet doit être dans l'inventaire d'un acteur.");
        return;
      }

      if (game.unicreon?.useWithTarget) {
        // Gestion unifiée : armes offensives, potions, objets, etc.
        return game.unicreon.useWithTarget({ item });
      }

      // Fallback : ancien comportement
      if (game.unicreon?.useItem) {
        return game.unicreon.useItem(item);
      }

      ui.notifications.warn(
        "Unicreon : aucune fonction d'utilisation trouvée (useWithTarget / useItem)."
      );
    });

    // --- Gestion des grants (dons) ---

    // Ajouter une ligne
    html.on("click", ".grant-add", ev => {
      ev.preventDefault();

      let grants = this.item.system.grantedItems;
      if (Array.isArray(grants)) {
        grants = grants.slice(); // copie
      } else if (grants && typeof grants === "object") {
        grants = Object.values(grants);
      } else {
        grants = [];
      }

      grants.push({ pack: "", name: "" });
      this.item.update({ "system.grantedItems": grants });
    });

    // Supprimer une ligne
    html.on("click", ".grant-del", async ev => {
      ev.preventDefault();
      const row = ev.currentTarget.closest(".grant-row");
      if (!row) return;

      const idx = Number(row.dataset.index);

      let grants = this.item.system.grantedItems;
      if (Array.isArray(grants)) {
        grants = grants.slice();
      } else if (grants && typeof grants === "object") {
        grants = Object.values(grants);
      } else {
        grants = [];
      }

      if (idx < 0 || idx >= grants.length) return;
      grants.splice(idx, 1);

      await this.item.update({ "system.grantedItems": grants });
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
