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

    html.on("click", "[data-action='use-item']", async ev => {
      ev.preventDefault();

      const item = this.item;
      const actor = item.parent;

      if (!actor) {
        ui.notifications.warn("L'objet doit être dans l'inventaire d'un acteur.");
        return;
      }

      // -------------------------------------------------------------------
      // CAS 1 : ARME OFFENSIVE → passe d'armes générique
      // -------------------------------------------------------------------
      const atkCfg = item.system?.attack ?? {};
      const isWeapon = item.type === "arme";
      const hasAPI = !!(game.unicreon && game.unicreon.resolveAttackFromItem);

      if (isWeapon && atkCfg.enabled && hasAPI) {
        const attackerToken =
          actor.getActiveTokens()[0] ||
          canvas.tokens.controlled[0] ||
          null;

        const targetToken =
          Array.from(game.user?.targets ?? [])[0] ||
          null;

        if (!attackerToken) {
          ui.notifications.warn(
            "Sélectionne d'abord le token de l'attaquant avant d'utiliser cette arme."
          );
          return;
        }

        if (!targetToken) {
          ui.notifications.warn(
            "Vise un token défenseur (Alt + clic) avant d'utiliser cette arme."
          );
          return;
        }

        await game.unicreon.resolveAttackFromItem({
          actor,
          attackerToken,
          targetToken,
          item
        });

        // Pour une arme : on ne passe PAS par useItem ensuite
        return;
      }

      // -------------------------------------------------------------------
      // CAS 2 : tout le reste → logique générique UNICREON.USE
      //         (potions, objets, sorts, etc.)
      // -------------------------------------------------------------------
      if (game.unicreon?.useItem) {
        game.unicreon.useItem(item);
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
