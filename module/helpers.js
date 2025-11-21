// systems/unicreon/module/helpers.js
// Helpers Handlebars globaux pour Unicreon

Hooks.once("init", () => {
    console.log("Unicreon | register Handlebars helpers");

    // Récupère Handlebars depuis le global (v12)
    const hb = globalThis.Handlebars || window.Handlebars;
    if (!hb) {
        console.error("Unicreon | Handlebars global introuvable");
        return;
    }

    // --- Helpers de base ------------------------------------------------------

    // Capitalise la première lettre
    hb.registerHelper("capitalize", s =>
        (s ?? "").charAt(0).toUpperCase() + (s ?? "").slice(1)
    );

    // Pour les <option> : ajoute "selected" si a == b
    hb.registerHelper("optionSel", (a, b) => (a == b ? "selected" : ""));

    // "d6" -> 6, "d10" -> 10, "0" -> 0
    hb.registerHelper("dieFaces", d =>
        (!d || d === "0") ? 0 : Number(String(d).replace("d", ""))
    );

    // Incrémente un index (pour les #each)
    hb.registerHelper("inc", n => Number(n) + 1);

    // Égalité stricte
    hb.registerHelper("eq", (a, b) => a === b);

    // a || b
    hb.registerHelper("or", (a, b) => Boolean(a || b));
});
