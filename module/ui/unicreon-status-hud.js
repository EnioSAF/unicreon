// systems/unicreon/module/ui/unicreon-status-hud.js
// HUD flottant Unicreon : PV + PM + Actions + PS + Karma + XP + Charge + Trait + Effets

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
            resizable: true,      // ✅ redimensionnable
            minimizable: true,    // ✅ minimisable
            width: 260,
            height: "auto"
        });
    }

    /** Flag interne : mode compact ou détaillé */
    get compact() {
        if (this._compact === undefined) this._compact = false;
        return this._compact;
    }

    set compact(value) {
        this._compact = !!value;
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

        data.compact = this.compact;

        if (!actor) {
            data.hasActor = false;
            return data;
        }

        data.hasActor = true;
        data.actorName = actor.name;

        const sys = actor.system ?? {};
        const pools = sys.pools ?? {};
        const derived = sys.derived ?? {};

        // -----------------------------------------------------------------------
        // PV (Vie) – on réplique la logique de la fiche : base + bonus pv.max
        // -----------------------------------------------------------------------
        const pvPool = pools.pv ?? {};
        const baseMaxRaw = Number(pvPool.max ?? 0);
        let baseVal = Number(pvPool.value ?? 0);
        const baseMax = Number.isFinite(baseMaxRaw) && baseMaxRaw > 0 ? baseMaxRaw : 0;

        if (!Number.isFinite(baseVal)) baseVal = 0;
        if (baseVal < 0) baseVal = 0;
        if (baseVal > baseMax) baseVal = baseMax;

        const bonusMap = derived.poolBonusValues ?? derived.poolBonusValues ?? {};
        const bonus = Number(bonusMap["pv.max"] ?? 0) || 0;

        const effectiveMax = Math.max(0, baseMax + bonus);
        let effectiveVal = baseVal + bonus;
        if (!Number.isFinite(effectiveVal)) effectiveVal = 0;
        if (effectiveVal < 0) effectiveVal = 0;
        if (effectiveVal > effectiveMax) effectiveVal = effectiveMax;

        const hpLeft = effectiveVal;
        const hpMax = effectiveMax;
        const hpPercent = hpMax > 0 ? Math.round((hpLeft / hpMax) * 100) : 0;

        data.hpLeft = hpLeft;
        data.hpMax = hpMax;
        data.hpPercent = hpPercent;

        // -----------------------------------------------------------------------
        // PM (mouvement) – même source que la fiche (system.pools.pm)
        // -----------------------------------------------------------------------
        const pmPool = pools.pm ?? {};
        let pmLeft = Number(pmPool.value ?? 0);
        let pmMax = Number(pmPool.max ?? 0);

        if (!Number.isFinite(pmLeft) || pmLeft < 0) pmLeft = 0;
        if (!Number.isFinite(pmMax) || pmMax < 0) pmMax = 0;
        if (pmLeft > pmMax) pmLeft = pmMax;

        const pmPercent = pmMax > 0 ? Math.round((pmLeft / pmMax) * 100) : 0;

        data.pmLeft = pmLeft;
        data.pmMax = pmMax;
        data.pmPercent = pmPercent;

        // -----------------------------------------------------------------------
        // Points de sorts (PS) – system.pools.ps
        // -----------------------------------------------------------------------
        const psPool = pools.ps ?? {};
        let psLeft = Number(psPool.value ?? 0);
        let psMax = Number(psPool.max ?? 0);

        if (!Number.isFinite(psLeft) || psLeft < 0) psLeft = 0;
        if (!Number.isFinite(psMax) || psMax < 0) psMax = 0;
        if (psLeft > psMax) psLeft = psMax;

        const psCrystals = [];
        for (let i = 0; i < psMax; i++) {
            psCrystals.push({
                index: i,
                used: i >= psLeft
            });
        }

        data.psLeft = psLeft;
        data.psMax = psMax;
        data.psCrystals = psCrystals;

        // -----------------------------------------------------------------------
        // Actions par tour – flags.unicreon comme sur la fiche
        // -----------------------------------------------------------------------
        const uFlags = actor.flags?.unicreon ?? {};
        const defaultActions = Number(game.unicreon?.actionsPerTurn ?? 2) || 2;

        let actionsTotal = Number(uFlags.actionsTotal ?? defaultActions);
        if (!Number.isFinite(actionsTotal) || actionsTotal < 1) actionsTotal = 1;

        let actionsLeft = Number(uFlags.actionsLeft ?? actionsTotal);
        if (!Number.isFinite(actionsLeft)) actionsLeft = actionsTotal;
        if (actionsLeft < 0) actionsLeft = 0;
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

        // -----------------------------------------------------------------------
        // Karma = PK (points de karma) – system.pools.pk.value
        // -----------------------------------------------------------------------
        const pkPool = pools.pk ?? {};
        let karma = Number(pkPool.value ?? 0);
        if (!Number.isFinite(karma)) karma = 0;
        data.karma = karma;

        // -----------------------------------------------------------------------
        // XP – même structure que la fiche (system.progress)
        // -----------------------------------------------------------------------
        const progress = sys.progress ?? {};
        let xpCurrent = Number(progress.xp ?? 0);
        let xpNext = Number(progress.xpNext ?? 0);

        if (!Number.isFinite(xpCurrent)) xpCurrent = 0;
        if (!Number.isFinite(xpNext)) xpNext = 0;

        const xpPercent = xpNext > 0 ? Math.round((xpCurrent / xpNext) * 100) : 0;

        data.xpCurrent = xpCurrent;
        data.xpNext = xpNext;
        data.xpPercent = xpPercent;

        // -----------------------------------------------------------------------
        // Charge – on lit le derived.carry calculé dans prepareDerivedData
        // -----------------------------------------------------------------------
        const carryDerived = derived.carry ?? {};
        let carryUsed = Number(carryDerived.used ?? 0);
        let carryMax = Number(carryDerived.max ?? 0);
        let carryPercent = Number(carryDerived.percent ?? 0);

        if (!Number.isFinite(carryUsed) || carryUsed < 0) carryUsed = 0;
        if (!Number.isFinite(carryMax) || carryMax < 0) carryMax = 0;

        if (!Number.isFinite(carryPercent)) {
            carryPercent = carryMax > 0 ? Math.round((carryUsed / carryMax) * 100) : 0;
        }

        data.carryUsed = carryUsed;
        data.carryMax = carryMax;
        data.carryPercent = carryPercent;

        // -----------------------------------------------------------------------
        // Mauvais trait / addiction – même logique que getNegativeTraitInfo
        // -----------------------------------------------------------------------
        let negativeTraitName = "";
        let addictionState = "none";

        if (game.unicreon?.getNegativeTraitInfo) {
            const info = game.unicreon.getNegativeTraitInfo(actor);
            if (info?.trait) negativeTraitName = info.trait.label || "";
            if (info?.trait && info.trait.key === "addicte") {
                addictionState = info.withdrawalActive ? "withdrawal" : "stable";
            }
        }

        data.negativeTraitName = negativeTraitName;
        data.addictionState = addictionState;

        // -----------------------------------------------------------------------
        // Effets actifs (Active Effects Foundry)
        // -----------------------------------------------------------------------
        const effects = [];
        for (const ef of actor.effects ?? []) {
            const changes = ef.changes ?? [];
            let changesText = changes
                .map((c) => `${c.key ?? "?"} ${c.mode ?? ""} ${c.value ?? ""}`)
                .join(", ");
            if (!changesText && ef.flags?.core?.statusId) {
                changesText = ef.flags.core.statusId;
            }
            const summary = changesText || "Effet actif";

            effects.push({
                id: ef.id,
                name: ef.name,
                icon: ef.icon,
                disabled: ef.disabled,
                summary
            });
        }

        data.effects = effects;
        data.hasEffects = effects.length > 0;

        return data;
    }


    /** Listeners du HUD */
    activateListeners(html) {
        super.activateListeners(html);

        // Toggle mode compact / détaillé
        html.find("[data-action='toggle-compact']").on("click", (event) => {
            event.preventDefault();
            this.compact = !this.compact;
            this.setPosition({ height: "auto" });
            this.render(false);
        });
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

    /**
     * Positionne le HUD en bas-gauche de l’écran,
     * uniquement si l’élément DOM existe.
     */
    function positionHudSafely() {
        if (!hud.element || hud.element.length === 0) return;

        const el = hud.element[0];
        const height = el.offsetHeight || 260;
        const margin = 40;

        const top = window.innerHeight - height - margin;
        hud.setPosition({ left: margin, top });
    }

    // OUVERTURE AUTO : dès qu'on sélectionne un token
    Hooks.on("controlToken", async (token, controlled) => {
        if (!controlled) return;

        if (!hud.rendered) {
            await hud.render(true, { focus: false });
        } else {
            await hud.refresh();
        }

        positionHudSafely();
    });

    // Quand le HUD se rend, on peut aussi le recaler
    Hooks.on("renderUnicreonStatusHUD", (app, html, data) => {
        positionHudSafely();
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
