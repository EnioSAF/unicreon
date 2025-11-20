// systems/unicreon/module/sheets/spell-sheet.js
// Fiche générique pour sorts / pouvoirs / potions magiques

export class UnicreonSpellSheet extends ItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["unicreon", "sheet", "item", "spell"],
            template: "systems/unicreon/templates/item/spell-sheet.hbs",
            width: 620,
            height: 540,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body" }]
        });
    }

    get template() {
        return `systems/${game.system.id}/templates/item/spell-sheet.hbs`;
    }

    getData(options = {}) {
        const data = super.getData(options);
        data.system = data.item.system ?? data.system ?? {};

        // config pour la liste des caracs dans le <select>
        data.config = {
            stats: {
                puissance: "Puissance",
                agilite: "Agilité",
                perception: "Perception",
                volonte: "Volonté",
                pouvoir: "Pouvoir"
            }
        };

        return data;
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.on("click", "[data-action='use-spell']", ev => {
            ev.preventDefault();
            if (game.unicreon?.useItem) {
                game.unicreon.useItem(this.item);
            } else {
                ui.notifications.warn(
                    "Unicreon : 'useItem' n'est pas dispo, vérifie unicreon.js."
                );
            }
        });
    }
}

Hooks.once("init", () => {
    console.log("Unicreon | registering UnicreonSpellSheet");

    Items.registerSheet("unicreon", UnicreonSpellSheet, {
        types: ["incantation", "pouvoir", "potion"],
        makeDefault: true,
        label: "Fiche de sort Unicreon"
    });
});
