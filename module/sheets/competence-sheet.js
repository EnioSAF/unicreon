export class UnicreonCompetenceSheet extends ItemSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["unicreon", "sheet", "competence"],
      width: 580,
      height: 640,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body" }]
    });
  }

  get template() {
    return `systems/${game.system.id}/templates/item/competence-sheet.hbs`;
  }

  getData(options) {
    const data = super.getData(options);

    data.config = {
      dice: { d4: "d4", d6: "d6", d8: "d8", d10: "d10", d12: "d12" },
      characteristics: {
        puissance: "Puissance",
        agilite: "Agilité",
        perception: "Perception",
        volonte: "Volonté"
      },
      skillTypes: {
        physique: "Physique",
        sociale: "Sociale",
        connaissance: "Connaissance",
        survie: "Survie",
        divers: "Divers"
      }
    };

    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // 🔥 Utilisation d'une compétence depuis sa fiche
    html.find(".competence-roll").on("click", async (ev) => {
      ev.preventDefault();

      if (!game.unicreon?.rollCompetence) {
        ui.notifications.warn("Le système Unicreon n'a pas chargé son helper de jet.");
        return;
      }

      // ⤵️ appel unique au helper global
      return game.unicreon.rollCompetence(this.item);
    });
  }
}
