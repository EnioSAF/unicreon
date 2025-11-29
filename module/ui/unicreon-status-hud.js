// systems/unicreon/module/ui/unicreon-status-hud.js
// HUD flottant Unicreon : PM + Actions (par acteur)

console.log("Unicreon | unicreon-status-hud.js loaded");

class UnicreonStatusHUD extends Application {
    static get defaultOptions() {
        const opts = super.defaultOptions;
        return foundry.utils.mergeObject(opts, {
            id: "unicreon-status-hud",
            classes: ["unicreon-status-hud", "unicreon", "app"],
            title: "Statut Unicreon",
            template: `systems/${game.system.id}/templates/ui/unicreon-status-hud.hbs`,
            popOut: true,
            resizable: false,
            minimizable: false,
            width: 230,
            height: "auto"
        });
    }

    /**
     * Acteur courant :
     * - en combat : combattant actif
     * - sinon : premier token contrôlé
     */
    get currentActor() {
        const combat = game.combat;
        if (combat && combat.combatant?.actor) {
            return combat.combatant.actor;
        }

        const controlled = canvas?.tokens?.controlled ?? [];
        if (controlled.length > 0) {
            return controlled[0].actor ?? null;
        }

        return null;
    }

    async getData(options = {}) {
        const data = await super.getData(options);
        const actor = this.currentActor;

        if (!actor) {
            data.hasActor = false;
            return data;
        }

        data.hasActor = true;
        data.actorName = actor.name;

        // -----------------------------------------------------------------------
        // PM (mouvement)
        // -----------------------------------------------------------------------
        let pmLeft = 0;
        let pmMax = 0;

        // Si tu as des helpers globaux, on les respecte
        if (game.unicreon?.getMoveLeft && game.unicreon?.getMoveMax) {
            pmLeft = Number(game.unicreon.getMoveLeft(actor) ?? 0);
            pmMax = Number(game.unicreon.getMoveMax(actor) ?? 0);
        } else {
            const pools = actor.system?.pools ?? {};
            const pm = pools.pm ?? {};
            pmLeft = Number(pm.value ?? 0);
            pmMax = Number(pm.max ?? 0);
        }

        if (!Number.isFinite(pmLeft)) pmLeft = 0;
        if (!Number.isFinite(pmMax)) pmMax = 0;
        if (pmMax < 0) pmMax = 0;
        if (pmLeft < 0) pmLeft = 0;
        if (pmLeft > pmMax) pmLeft = pmMax;

        const pmPercent = pmMax > 0 ? Math.round((pmLeft / pmMax) * 100) : 0;

        data.pmLeft = pmLeft;
        data.pmMax = pmMax;
        data.pmPercent = pmPercent;

        // -----------------------------------------------------------------------
        // Points de sorts (PS) – pool system.pools.ps
        // -----------------------------------------------------------------------
        const psPool = actor.system?.pools?.ps ?? {};
        let psLeft = Number(psPool.value ?? 0);
        let psMax = Number(psPool.max ?? 0);

        if (!Number.isFinite(psLeft)) psLeft = 0;
        if (!Number.isFinite(psMax)) psMax = 0;
        if (psMax < 0) psMax = 0;
        if (psLeft < 0) psLeft = 0;
        if (psLeft > psMax) psLeft = psMax;

        // On représente chaque point de sort par un cristal bleu
        const psCrystals = [];
        for (let i = 0; i < psMax; i++) {
            psCrystals.push({
                index: i,
                used: i >= psLeft      // used = déjà dépensé
            });
        }

        data.psLeft = psLeft;
        data.psMax = psMax;
        data.psCrystals = psCrystals;

        // -----------------------------------------------------------------------
        // Actions (par acteur, via flags)
        // flags.unicreon.actionsTotal : nombre total d'actions
        // flags.unicreon.actionsLeft  : actions restantes
        // -----------------------------------------------------------------------
        let actionsTotal = Number(actor.getFlag("unicreon", "actionsTotal"));

        if (!Number.isFinite(actionsTotal) || actionsTotal <= 0) {
            // fallback : paramètre global ou 2
            if (game.unicreon?.actionsPerTurn) {
                actionsTotal = Number(game.unicreon.actionsPerTurn) || 2;
            } else {
                actionsTotal = 2;
            }
        }

        let actionsLeft = Number(actor.getFlag("unicreon", "actionsLeft"));
        if (!Number.isFinite(actionsLeft) || actionsLeft < 0) {
            // si aucun flag encore, on peut utiliser un helper global,
            // sinon on considère qu'il lui reste tout.
            if (game.unicreon?.getActionsLeft) {
                actionsLeft = Number(game.unicreon.getActionsLeft(actor) ?? actionsTotal);
            } else {
                actionsLeft = actionsTotal;
            }
        }

        if (actionsLeft > actionsTotal) actionsLeft = actionsTotal;

        const crystals = [];
        for (let i = 0; i < actionsTotal; i++) {
            crystals.push({
                index: i,
                used: i >= actionsLeft
            });
        }

        data.actionsLeft = actionsLeft;
        data.actionsTotal = actionsTotal;
        data.crystals = crystals;

        return data;
    }

    /** Rafraîchir sans bouger la fenêtre. */
    async refresh() {
        if (!this.rendered) {
            return this.render(true);
        }
        return this.render(false);
    }
}

// ---------------------------------------------------------------------------
// Hooks : ouverture sur sélection + refresh en temps réel
// ---------------------------------------------------------------------------

Hooks.once("ready", () => {
    console.log("Unicreon | Status HUD ready hook");

    game.unicreon = game.unicreon || {};

    // Singleton
    const hud = new UnicreonStatusHUD();
    game.unicreon.statusHud = hud;

    // Aide : ouvrir le HUD à la main dans la console
    game.unicreon.openStatusHud = () => hud.render(true, { focus: true });

    // OUVERTURE AUTO : dès qu'on sélectionne un token
    Hooks.on("controlToken", (token, controlled) => {
        if (!controlled) return; // on ne gère que le moment où il devient contrôlé
        hud.render(true, { focus: false });

        // position par défaut en bas-gauche
        const top = window.innerHeight - 260;
        hud.setPosition({ left: 40, top });
    });

    // Changement de tour en combat → l'acteur courant change → refresh
    Hooks.on("combatTurnChange", () => {
        if (!hud.rendered) return;
        hud.refresh();
    });

    // Quand un acteur est mis à jour → si c'est celui suivi, on rafraîchit
    const refreshIfCurrent = (actor) => {
        if (!hud.rendered) return;
        const current = hud.currentActor;
        if (!current) return;
        if (current.id !== actor.id) return;
        hud.refresh();
    };

    Hooks.on("updateActor", (actor) => {
        refreshIfCurrent(actor);
    });

    Hooks.on("updateToken", (scene, tokenDoc) => {
        const actor = tokenDoc.actor;
        if (actor) refreshIfCurrent(actor);
    });
});
