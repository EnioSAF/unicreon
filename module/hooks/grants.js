// systems/unicreon/module/grants.js
// Gestion des "dons" d'objets : compétences / sorts accordés quand l'objet est équipé.

console.warn("UNICREON | grants.js LOADED (v3 DEBUG PACK-OPTIONAL)");

// ============================================================================
// Helpers : lecture / normalisation de la config de dons
// ============================================================================

function unicreonGetGrantedSpecsFromItem(item) {
    const raw = item.system?.grantedItems;
    console.log("UNICREON | getGrantedSpecs RAW =", raw, "pour item =", item?.name);

    if (!raw) return [];

    const normalize = (g) => ({
        pack: g?.pack ? String(g.pack).trim() : "",   // pack facultatif
        id: g?.id ? String(g.id).trim() : null,
        name: g?.name ? String(g.name).trim() : null
    });

    let specs = [];

    if (Array.isArray(raw)) {
        specs = raw.map(normalize);
    } else if (typeof raw === "object") {
        const looksLikeSingle =
            Object.prototype.hasOwnProperty.call(raw, "pack") ||
            Object.prototype.hasOwnProperty.call(raw, "id") ||
            Object.prototype.hasOwnProperty.call(raw, "name");

        if (looksLikeSingle) {
            specs = [normalize(raw)];
        } else {
            specs = Object.values(raw).map(normalize);
        }
    } else {
        return [];
    }

    // On exige juste un nom ou un id, pas de pack obligatoire
    specs = specs.filter((g) => g.id || g.name);

    console.log("UNICREON | getGrantedSpecs NORMALISÉ =", specs);
    return specs;
}

// ============================================================================
// Recherche dans les compendiums
// ============================================================================

async function unicreonFindInPackByNameOrId(pack, spec) {
    // 1) id direct
    if (spec.id) {
        try {
            const doc = await pack.getDocument(spec.id);
            if (doc) return doc;
        } catch (e) {
            console.warn("Unicreon | getDocument a échoué pour", pack.collection, spec.id, e);
        }
    }

    // 2) via index par nom
    if (spec.name) {
        const indexEntry = pack.index.getName(spec.name);
        if (indexEntry) {
            try {
                const doc = await pack.getDocument(indexEntry._id);
                if (doc) return doc;
            } catch (e) {
                console.warn("Unicreon | getDocument par nom a échoué", pack.collection, spec.name, e);
            }
        }

        // 3) full load en dernier recours
        try {
            const docs = await pack.getDocuments();
            return docs.find((d) => d.name === spec.name) ?? null;
        } catch (e) {
            console.warn("Unicreon | getDocuments a échoué pour", pack.collection, e);
        }
    }

    return null;
}

/**
 * Récupère un document à partir d'un spec.
 * - si spec.pack est renseigné : cherche dans ce compendium
 * - sinon : tente dans tous les compendiums d'Items
 */
async function unicreonFindGrantSource(spec) {
    if (spec.pack) {
        const pack = game.packs.get(spec.pack);
        if (!pack) {
            console.warn("Unicreon | Compendium introuvable pour grant :", spec.pack);
            return null;
        }

        console.log("UNICREON | Recherche grant dans pack", spec.pack, "spec =", spec);
        return await unicreonFindInPackByNameOrId(pack, spec);
    }

    // Pas de pack : on scanne tous les compendiums d'Items
    console.log("UNICREON | Recherche SANS PACK pour spec =", spec);

    const itemPacks = Array.from(game.packs).filter(
        (p) => p.documentName === "Item"
    );

    for (const pack of itemPacks) {
        const doc = await unicreonFindInPackByNameOrId(pack, spec);
        if (doc) {
            console.log(
                "UNICREON | Grant trouvé dans pack",
                pack.collection,
                "pour",
                spec.name || spec.id
            );
            return doc;
        }
    }

    console.warn("UNICREON | Aucun doc trouvé pour spec (tous packs scannés)", spec);
    return null;
}

// ============================================================================
// Application / retrait des dons
// ============================================================================

async function unicreonApplyGrantedItems({ item, equipped }) {
    const actor = item.parent;
    if (!actor) {
        console.warn("UNICREON | applyGrantedItems sans actor pour", item?.name);
        return;
    }

    const specs = unicreonGetGrantedSpecsFromItem(item);
    if (!specs.length) {
        console.log("UNICREON | applyGrantedItems : aucun spec pour", item.name);
        return;
    }

    const grantFlagKey = "grantedBy";
    const grantFlagNamespace = "unicreon";
    const grantSource = item.uuid;

    console.log("UNICREON | applyGrantedItems", {
        item: item.name,
        actor: actor.name,
        equipped,
        specs
    });

    if (equipped) {
        const existingGranted = actor.items.filter(
            (i) => i.getFlag(grantFlagNamespace, grantFlagKey) === grantSource
        );
        if (existingGranted.length > 0) {
            console.log("UNICREON | Items déjà grantés, rien à faire :", existingGranted.map((i) => i.name));
            return;
        }

        const toCreate = [];

        for (const spec of specs) {
            const src = await unicreonFindGrantSource(spec);
            if (!src) {
                ui.notifications.warn(
                    `Impossible de trouver "${spec.id || spec.name}" dans les compendiums.`
                );
                continue;
            }

            const data = src.toObject();
            delete data._id;

            data.flags = data.flags || {};
            data.flags[grantFlagNamespace] = data.flags[grantFlagNamespace] || {};
            data.flags[grantFlagNamespace][grantFlagKey] = grantSource;

            toCreate.push(data);
        }

        console.log("UNICREON | toCreate =", toCreate);

        if (toCreate.length > 0) {
            await actor.createEmbeddedDocuments("Item", toCreate);
            console.log(
                "Unicreon | Items grantés AJOUTÉS via équipement de",
                item.name,
                "→",
                toCreate.map((d) => d.name)
            );
        }
    } else {
        const toDelete = actor.items.filter(
            (i) => i.getFlag(grantFlagNamespace, grantFlagKey) === grantSource
        );

        console.log("UNICREON | toDelete =", toDelete.map((i) => i.name));

        if (toDelete.length > 0) {
            await actor.deleteEmbeddedDocuments(
                "Item",
                toDelete.map((i) => i.id)
            );
            console.log(
                "Unicreon | Items grantés SUPPRIMÉS car déséquipement de",
                item.name,
                "→",
                toDelete.map((i) => i.name)
            );
        }
    }
}

// ============================================================================
// Hooks : suivi d'équipement / suppression
// ============================================================================

Hooks.on("updateItem", async (item, changes, options, userId) => {
    console.log("UNICREON | updateItem HOOK", {
        name: item?.name,
        actor: item?.parent?.name,
        changes,
        equippedNow: item.system?.equipped,
        grantedItems: item.system?.grantedItems
    });

    if (!item.parent || !(item.parent instanceof Actor)) {
        console.log("UNICREON | updateItem : pas d'actor, on skip.");
        return;
    }

    const specs = unicreonGetGrantedSpecsFromItem(item);
    if (!specs.length) {
        console.log("UNICREON | updateItem : pas de specs de grant, on skip.");
        return;
    }

    const nowEquipped = !!item.system?.equipped;
    console.log("UNICREON | updateItem → call applyGrantedItems avec equipped =", nowEquipped);
    await unicreonApplyGrantedItems({ item, equipped: nowEquipped });
});

Hooks.on("preDeleteItem", async (item, options, userId) => {
    const actor = item.parent;
    if (!actor || !(actor instanceof Actor)) return;

    const grantFlagKey = "grantedBy";
    const grantFlagNamespace = "unicreon";
    const grantSource = item.uuid;

    const toDelete = actor.items.filter(
        (i) => i.getFlag(grantFlagNamespace, grantFlagKey) === grantSource
    );

    console.log("UNICREON | preDeleteItem", {
        item: item.name,
        actor: actor.name,
        toDelete: toDelete.map((i) => i.name)
    });

    if (toDelete.length > 0) {
        await actor.deleteEmbeddedDocuments(
            "Item",
            toDelete.map((i) => i.id)
        );
        console.log(
            "Unicreon | Items grantés retirés car suppression de",
            item.name,
            "→",
            toDelete.map((i) => i.name)
        );
    }
});
