/**
 * Client styles for the Trae plugin card.
 * Copied verbatim from `dsh-subagent-default-model`'s SETTINGS_CSS so the two
 * plugins share one external-presentation language (same card shell, same
 * button primitives, same `--dsw-alias-*` token palette).
 */

export const TRAE_CARD_CSS = `
.dsm-plugin-card{border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-3,#202126);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.dsm-plugin-card:hover{border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-plugin-card-open{background:var(--dsw-alias-bg-layer-2,#25262b);border-color:var(--dsw-alias-label-dimmed,#777)}
.dsm-plugin-card-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:transparent;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.dsm-plugin-card-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:-2px}
.dsm-plugin-card-head{flex-direction:column;flex:1;gap:6px;min-width:0;display:flex}
.dsm-plugin-card-title{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:15px;font-weight:600;line-height:1.4}
.dsm-plugin-card-description{color:var(--dsw-alias-label-tertiary,#999);font-size:12.5px;line-height:1.55}
/* Pure-CSS caret: the host primitives' chevron icon names are not part of any
   stable contract across DSH releases, so no static import is used 鈥?a border
   caret in the plugin's own CSS is version-proof. */
.dsm-plugin-card-chevron{color:var(--dsw-alias-label-tertiary,#999);flex:none;width:16px;height:16px;position:relative;transition:transform .16s}
.dsm-plugin-card-chevron::before{content:"";display:block;position:absolute;left:4px;top:5px;width:7px;height:7px;border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(45deg)}
.dsm-plugin-card-chevron-open{transform:rotate(180deg)}
.dsm-plugin-card-body{border-top:1px solid var(--dsw-alias-border-l2,#36373b);margin:0 16px;padding:0 0 8px}
.dsm-plugin-card-icon{width:32px;height:32px;flex:none;border-radius:7px}
.dsm-plugin-card-body .dsm-model-settings{margin:0;padding:12px 0 0;background:transparent;border:0;border-radius:0}
.dsm-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.dsm-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-btn:disabled{opacity:.4;cursor:default}
.dsm-btn-outline{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent;font-weight:500}
.dsm-btn-outline:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:rgba(255,255,255,.04)}
.dsm-btn-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dsm-btn-primary:hover:not(:disabled){opacity:.9}
.dsm-trae-mainui-switch{display:flex;justify-content:flex-end;padding:0 2px 8px}
.dsm-trae-mainui-switch-label{display:inline-flex;align-items:center;gap:6px;font-size:13px;line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0);white-space:nowrap;cursor:pointer}
.dsm-trae-mainui-switch-label input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-trae-mainui-switch-label:has(input:disabled){opacity:.6;cursor:default}
.dsm-trae-usage{display:flex;flex-direction:column;gap:16px;margin:0;padding:16px 0 4px}
.dsm-trae-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.dsm-trae-tab-cell{display:flex;align-items:center;gap:4px;min-width:0;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:10px;background:var(--dsw-alias-bg-layer-3,#2a2c33);transition:border-color .15s,background .15s}
.dsm-trae-tab-cell:hover{border-color:var(--dsw-alias-label-dimmed,#777)}
/* The selected tab is marked on its CHIP, not on the button inside it: an
   inset ring on an inner button, inside a bordered strip, drew two borders
   a few pixels apart and read as a rendering mistake. The chip carries the
   accent border, so the switch beside the label stays in the same unit. */
.dsm-trae-tab-cell:has(.dsm-trae-tab-active){border-color:var(--dsw-alias-brand-primary,#5686fe);background:var(--dsw-alias-bg-layer-2,#232529)}
.dsm-trae-tab{appearance:none;font:inherit;cursor:pointer;flex:1;min-width:0;border:0;border-radius:7px;padding:0;color:var(--dsw-alias-label-tertiary,#999);font-size:13px;font-weight:600;line-height:20px;background:transparent;text-align:left;transition:color .15s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-trae-tab:hover:not(:disabled):not(.dsm-trae-tab-active){color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-trae-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-trae-tab-active{color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-trae-tab-off{opacity:.55}
/* Same checkbox as the settings block (.dsm-trae-switch); only the padding
   differs, so it sits inside the tab cell without crowding the label. */
.dsm-trae-tab-switch{flex:none;margin-left:auto;padding-left:10px;border-left:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24))}
.dsm-trae-tab-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;vertical-align:baseline}
.dsm-trae-tab-hint{margin:0;padding:0 2px;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
/* SECTION TABS: the card's own top-level split (account / models / diagnostics).
 *
 * Deliberately NOT the boxed chips above. Those are the REGION scope — a
 * three-way choice of which PROVIDER this whole card is about, each chip
 * carrying its own on/off switch — while these are panels of ONE document, the
 * shape a reader already knows from the app's own settings window. Two rows of
 * boxes would read as one six-way choice.
 *
 * The hidden ATTRIBUTE on each panel is what does the work: an inactive panel
 * stays MOUNTED, so switching back does not refetch, a half-filled model draft
 * survives the trip, and the account pool keeps its log. It also takes the
 * inactive panel out of the accessibility tree, which is exactly what
 * role="tabpanel" wants — unlike display:none reached by a CSS class, the user
 * agent's own rule for [hidden] cannot be overridden by a later declaration. */
.dsm-trae-panels{display:flex;align-items:stretch;gap:2px;margin:4px 0 0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24))}
.dsm-trae-panel-tab{appearance:none;font:inherit;cursor:pointer;border:0;background:transparent;padding:7px 11px;margin-bottom:-1px;border-bottom:2px solid transparent;color:var(--dsw-alias-label-tertiary,#999);font-size:13px;font-weight:600;line-height:20px;white-space:nowrap;transition:color .15s,border-color .15s}
.dsm-trae-panel-tab:hover:not(.dsm-trae-panel-tab-active){color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-trae-panel-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-trae-panel-tab-active{color:var(--dsw-alias-label-primary,#e6e6e6);border-bottom-color:var(--dsw-alias-brand-primary,#5686fe)}
/* No top margin of its own: the strip above already carries a border, and the
   card's 16px stack gap would double the separation. */
.dsm-trae-panel{margin-top:0}
/* DIAGNOSTICS: a two-column fact table rather than prose. Each row is one thing
 * the card actually READ, so a bug report can quote a line instead of
 * paraphrasing the UI. No control lives here on purpose — a diagnostics panel
 * that can change settings is a settings panel with a worse name. */
.dsm-trae-diag{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#232529)}
.dsm-trae-diag-row{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:8px 12px}
.dsm-trae-diag-row+.dsm-trae-diag-row{border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24))}
.dsm-trae-diag-label{flex:none;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
.dsm-trae-diag-value{min-width:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:12px;line-height:18px;text-align:right;overflow-wrap:anywhere}
.dsm-trae-diag-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
/* A failure line, in the same warn tone the card already uses for an expiring
   credit — NOT a hand-rolled amber. The token set the card asks DSH for is
   audited by the card-styles spec (every name must be one the host actually
   defines), so this deliberately names state-warn-primary rather than the
   sibling card's label-caution, which this suite has never verified. */
.dsm-trae-diag-bad{color:var(--dsw-alias-state-warn-primary,#b45309)}
.dsm-trae-diag-hint{margin:10px 0 0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
.dsm-trae-credits-unavailable{margin:10px 0 0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:10px;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:18px;background:var(--dsw-alias-bg-layer-3,#2a2c33)}
.dsm-trae-account-value-muted{color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px}
.dsm-trae-tab-off-notice{margin:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:10px;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:18px;background:var(--dsw-alias-bg-layer-3,#2a2c33)}
.dsm-trae-usage-account{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:14px;background:var(--dsw-alias-bg-layer-2,#24262c)}
.dsm-trae-usage-account-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.dsm-trae-usage-expiry{padding-left:19px;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:18px}
/* Refresh-token countdown (issue #37 follow-up). Sits under the access-token
   line and aligns with it, so the two read as one stack: "token renews" then
   "but this is when renewal itself ends". Only rendered when it is close or
   already past, so a healthy account is unchanged. */
.dsm-trae-refresh-warn{padding-left:19px;font-size:12px;line-height:18px}
.dsm-trae-refresh-warn-soon{color:var(--dsw-alias-state-warn-primary,#b45309)}
.dsm-trae-refresh-warn-lapsed{color:var(--dsw-alias-state-error-primary,#dc2626)}
.dsm-trae-account-picker{display:block}
/* The 璁剧疆 block: label + hint on the left, control on the right, one save for
   the whole block. It replaces the bare checkbox rows that used to write on
   every click 鈥?a draft needs a visible way back out, so each row carries its
   own explanation and the footer carries the buttons. */
/* The preference switches: BARE LINES, one per switch, each with its label
   wrapped around the box so the whole line is a click target.
 *
 * The 璁剧疆 block used to be a bordered box with a heading, two rows and a
 * 銆屼繚瀛樸€?銆屾斁寮冦€?footer. That is gone with the draft it existed to serve 鈥?this
 * is the sibling dsh-connect-workbuddy card's shape, where a preference is a
 * checkbox on a line that commits on the click. */
.dsm-trae-prefs{display:flex;flex-direction:column;gap:14px;padding:2px 2px 0}
.dsm-trae-pref{display:flex;align-items:flex-start;gap:10px;font-size:13px;line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0);cursor:pointer}
.dsm-trae-pref input{flex:none;cursor:pointer;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-trae-pref-check{inline-size:15px;block-size:15px;margin:3px 0 0}
/* The label and its explanation used to run together as one wrapped blob
   ("在输入框工具栏显示积分读数 在输入框工具栏显示可点击读数…"), which is what made
   this block read as a wall of text. They are two lines now: what the switch
   does, then what it means. */
.dsm-trae-pref-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.dsm-trae-pref-label{font-weight:500;color:var(--dsw-alias-label-primary,#e6e6e6)}
/* The select sits NEXT TO its label ("显示位置 [输入框工具栏 ▾]"), not at the far
   right of the card. Pushing it to the opposite edge split one sentence into
   two objects with half a card of empty space between them, and left the reader
   to guess which label the control belonged to. The row packs from the left;
   nothing in it stretches. */
.dsm-trae-pref-lead{display:flex;align-items:center;justify-content:flex-start;gap:10px;min-width:0}
.dsm-trae-pref-lead .dsm-trae-pref-label{flex:none}
.dsm-trae-pref input:disabled{cursor:default}
.dsm-trae-pref:has(input:disabled){opacity:.6;cursor:default}
.dsm-trae-pref b{font-weight:500;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-trae-pref-hint{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:17px}
.dsm-trae-pref span{min-width:0}
/* The credit readout's seat picker (learned from workbuddy #62). Its OWN label
   class, deliberately not the plain .dsm-trae-pref the two checkboxes use: a
   query for "the composer-credits switch" must not be able to pick this control
   up, because the two are different widgets and a test selecting by position
   would otherwise start asserting about a <select>.
   The select keeps its own class for the same reason, and takes the checkbox
   column's width so it reads as a sibling of the box rather than a stray row. */
/* The select row has no checkbox, so it borrows the checkbox's column as
   padding — its label must start on the same left edge as the two labels
   above it (15px box + 10px gap). */
.dsm-trae-credit-position-pref{align-items:flex-start;padding-left:25px}
/* Sized by its own two options, not stretched: the control answers one short
   question and sits beside the words that ask it. */
.dsm-trae-credit-position{flex:none;max-width:none;margin-top:0;padding:3px 8px;font-size:12px;line-height:16px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:7px;background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-primary,#e6e6e6);cursor:pointer}
.dsm-trae-credit-position:disabled{cursor:default}
/* The card's checkboxes are the platform's own, styled only with
   accent-color 鈥?the SAME idiom .dsm-trae-mainui-switch-label above already
   uses for the composer-line switch, and the one the sibling
   dsh-connect-workbuddy card uses for its tab and credits boxes.
 *
 * These were drawn by hand for one release: a 34x20 track with a 14px knob,
 * --dsw-alias-brand-primary when checked. That token is DSH's CONTRAST colour
 * (#0f1115 light / #f9fafb dark), not an accent, so a checked box came out as a
 * solid black pill 鈥?heavier than anything else in the card, and unrelated to
 * the native box sitting two centimetres away in the composer toolbar. The
 * platform checkbox tracks the host's own accent and dark mode for free. */
.dsm-trae-switch{display:inline-flex;align-items:center;cursor:pointer}
.dsm-trae-switch input{margin:0;cursor:pointer;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-trae-switch input:disabled{cursor:default}
.dsm-trae-switch:has(input:disabled){opacity:.6;cursor:default}
/* A pill, only where a pill is the idiom: the standalone preference rows.
   appearance:none hands the geometry to the stylesheet, so the track and the
   knob are ours. It is scoped rather than global because the tab row's switch
   sits inside a chip — a pill there reads as a second button, which is exactly
   how it looked when this was global. */
.dsm-trae-switch-pill{display:inline-flex;align-items:center}
.dsm-trae-switch-pill input{appearance:none;-webkit-appearance:none;position:relative;inline-size:36px;block-size:20px;border:0;border-radius:999px;background:var(--dsw-alias-border-l2,#c4c7cc);transition:background-color .15s ease}
.dsm-trae-switch-pill input::after{content:"";position:absolute;inset-block-start:2px;inset-inline-start:2px;inline-size:16px;block-size:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-3,#fff);box-shadow:0 1px 2px rgba(0,0,0,.24);transition:transform .15s ease}
.dsm-trae-switch-pill input:checked{background:var(--dsw-alias-brand-primary,#1b1c1e)}
.dsm-trae-switch-pill input:checked::after{transform:translateX(16px)}
/* The account block is a real table: the question it answers is "which of these
   accounts, and what is the action on each one" 鈥?a dropdown can only ever show
   the one already chosen. */
.dsm-trae-accounts{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:14px;background:var(--dsw-alias-bg-layer-2,#24262c)}
.dsm-trae-accounts-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
/* The refresh button must not be squeezed into two lines by a long hint. */
.dsm-trae-accounts-head>button{flex:none;white-space:nowrap}
.dsm-trae-accounts-title{margin:0;font-size:13px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-trae-accounts-hint{margin:3px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
/* The account rows: two lines each 鈥?who the account is, then what it is worth
   鈥?with the one action that applies to THAT row on the right. A four-column
   table was the wrong instrument here: every field demanded its own header, the
   columns drifted with the content ("LaoDing" vs a full expiry stamp), and the
   bound row repeated its "in use" badge in two different columns. */
/* The account table, shaped like the sibling WorkBuddy card's pool table: a
   bordered container, a tinted header row, and one grid row per account whose
   tracks are FRACTIONS of the container rather than sizes derived from the
   content. That is the whole point 鈥?the previous four-column table let each
   column grow with its own text, so the columns did not line up from row to row
   and the table read as noise in a narrow panel. */
.dsm-trae-account-table{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:var(--dsm-trae-pool-radius);overflow:hidden;background:var(--dsw-alias-bg-layer-2,#24262c)}
/* Four tracks where the region has a check-in column, three where it does not
   (the international region has no check-in at all: the ug/* family answers
   404 on every ai gateway, so the column is absent rather than empty and
   permanently unknown). The freed track goes to the account name. */
.dsm-trae-account-row{display:grid;grid-template-columns:1.7fr 1.1fr 1fr 1.1fr;gap:10px;align-items:center;padding:9px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));font-size:13px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-trae-account-table:not(.dsm-trae-account-table-checkin) .dsm-trae-account-row{grid-template-columns:2.2fr 1.2fr 1.1fr}
.dsm-trae-account-row:first-child{border-top:0}
.dsm-trae-account-row-head{padding:7px 12px;background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-tertiary,#999);font-size:11px;font-weight:600;letter-spacing:.02em;text-transform:uppercase}
/* The serving row, findable at a glance: the accent bar is what distinguishes it
   in a long table, where the 7%-opacity wash alone reads as a zebra stripe. */
.dsm-trae-account-row-current{background:rgba(86,134,254,.07);box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary,#5686fe)}
.dsm-trae-account-who{display:flex;align-items:center;gap:8px;min-width:0}
.dsm-trae-account-who .dsm-trae-usage-dot{margin-right:0;flex:none}
.dsm-trae-account-name{display:flex;flex-direction:column;gap:1px;min-width:0}
.dsm-trae-account-name b{font-weight:500;color:var(--dsw-alias-label-primary,#e6e6e6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-trae-account-row-current .dsm-trae-account-name b{font-weight:600}
/* Declared AFTER the blanket span rule above so it wins: the badge must not
   inherit the muted 11px tertiary treatment the edition line uses. */
.dsm-trae-account-name .dsm-trae-account-badge{align-self:flex-start;margin-top:2px;padding:1px 6px;border-radius:999px;font-size:10px;line-height:15px;font-weight:600;white-space:nowrap;color:var(--dsw-alias-brand-primary,#5686fe);background:rgba(86,134,254,.14)}
.dsm-trae-account-meta{display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a8);min-width:0}
.dsm-trae-account-meta i{font-style:normal;opacity:.4}
.dsm-trae-account-note{font-size:11px;line-height:16px;color:var(--dsw-alias-state-error-primary,#ef4444)}
/* Its own track, in tabular figures, so digits in different rows sit on the same
   column of the grid instead of jittering with the glyph widths. */
.dsm-trae-account-worth{display:flex;flex-direction:column;gap:1px;min-width:0;font-variant-numeric:tabular-nums}
.dsm-trae-account-value{color:var(--dsw-alias-label-primary,#e6e6e6);font-weight:600}
.dsm-trae-account-value-on{color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsm-trae-account-checkin-cell{display:flex;align-items:center;min-width:0}
.dsm-trae-account-actions{display:flex;align-items:center;gap:6px;justify-content:flex-end;flex:none}
/* The per-row switch is the shared outline button, only smaller: one button
   vocabulary in the card instead of a bespoke one per block. */
.dsm-trae-account-row .dsm-trae-account-switch{padding:2px 10px;font-size:12px}
@media (max-width:760px){.dsm-trae-account-row,.dsm-trae-account-table:not(.dsm-trae-account-table-checkin) .dsm-trae-account-row{grid-template-columns:1fr 1fr;row-gap:6px}.dsm-trae-account-row-head{display:none}}
/* The check-in is the only action on this card that reaches upstream account
   state, so it is the one button allowed a colour. Everything else in the row
   defers to it. */
.dsm-trae-account-checkin{appearance:none;font:inherit;cursor:pointer;white-space:nowrap;border:1px solid rgba(86,134,254,.4);border-radius:7px;padding:2px 9px;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-brand-primary,#5686fe);background:rgba(86,134,254,.08)}
.dsm-trae-account-checkin:hover:not(:disabled){background:rgba(86,134,254,.16)}
.dsm-trae-account-checkin:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-trae-account-checkin-state{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a8);white-space:nowrap}
/* A disabled check-in still STATES something ("claimed", "device used"), so it
   stays readable 鈥?clearly inactive, not invisible. */
.dsm-trae-account-checkin:disabled{opacity:.55;cursor:default;border-color:transparent;color:var(--dsw-alias-label-tertiary,#9aa0a8);background:transparent}
/* The switch is the row's LIVE control, so it is brighter than the inert
   check-in labels beside it: same shape, different weight. */
.dsm-trae-account-switch{appearance:none;font:inherit;cursor:pointer;white-space:nowrap;border:0;border-radius:7px;padding:3px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0);background:transparent}
.dsm-trae-account-switch:hover:not(:disabled){color:var(--dsw-alias-brand-primary,#5686fe);background:rgba(86,134,254,.12)}
.dsm-trae-account-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-trae-account-switch:disabled{opacity:.45;cursor:default}
.dsm-trae-mark{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:5px;font-size:11px;font-weight:700;color:#111;background:linear-gradient(135deg,#ffd36e,#ffb84d);margin-right:6px}
.dsm-trae-usage-list{display:flex;flex-direction:column;gap:10px}
.dsm-trae-usage-text{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary,#b8b8b8)}
.dsm-trae-usage-error{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-state-error-primary,#ef4444)}
.dsm-trae-usage-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}
.dsm-trae-usage-status{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:500;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-trae-usage-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:2px}
.dsm-trae-usage-stats-two{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.dsm-trae-usage-stat{position:relative;display:flex;flex-direction:column;gap:9px;padding:16px 16px 14px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:14px;background:var(--dsw-alias-bg-layer-2,#24262c);overflow:hidden;min-width:0}
.dsm-trae-usage-stat::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;opacity:.9}
.dsm-trae-usage-stat-work::before{background:#9ca2aa}
.dsm-trae-usage-stat-general::before{background:#4d9b6d}
.dsm-trae-usage-stat-head{display:flex;align-items:center;gap:7px;min-width:0}
.dsm-trae-usage-stat-label{font-size:13px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary,#c6c9d0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-trae-usage-stat-badge{margin-left:auto;flex:0 0 auto;padding:2px 8px;border-radius:999px;font-size:11px;line-height:15px;font-weight:600;letter-spacing:.2px}
.dsm-trae-usage-stat-badge-off{color:#aeb3bb;background:rgba(174,179,187,.11)}
.dsm-trae-usage-stat-badge-on{color:#3f8d60;background:rgba(63,141,96,.13)}
.dsm-trae-usage-stat-value{font-size:32px;line-height:36px;font-weight:700;letter-spacing:-.5px;white-space:nowrap;font-variant-numeric:tabular-nums}
.dsm-trae-usage-stat-value-general{color:#3f8d60}
.dsm-trae-usage-stat-value-work{color:#9298a0}
.dsm-trae-usage-stat-hint{margin:2px 0 0;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-trae-models{display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding-top:14px}
.dsm-trae-models-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsm-trae-models-title{margin:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:20px}
.dsm-trae-models-summary{margin:2px 0 0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
/* EVERY model is on the page — no inner scroller, no max-height.
 *
 * A capped list with its own scrollbar was tried and rejected by the user: it
 * turned a settings section into a little window that has to be scrolled inside
 * a page that already scrolls, and put the models a user is looking for behind a
 * gesture that does not match the rest of the card. The section is allowed to be
 * as tall as the catalog is; the card's own page scroll is the only scroll.
 *
 * overflow:hidden is for the rounded border only (so the row hairlines cannot
 * paint outside the radius). It is deliberately NOT auto: nothing here clips
 * content vertically. */
.dsm-trae-model-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;overflow:hidden}
.dsm-trae-model{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2,#232529);transition:opacity .16s}
.dsm-trae-model-disabled{opacity:.55}
.dsm-trae-model+.dsm-trae-model{border-top:1px solid var(--dsw-alias-border-l2,#36373b)}
.dsm-trae-model-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.dsm-trae-model-enabled{display:flex;align-items:center;gap:8px;min-width:0;cursor:pointer}
.dsm-trae-model-enabled input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe);flex:none}
.dsm-trae-model-copy{display:flex;align-items:baseline;gap:8px;min-width:0}
.dsm-trae-model-name{display:inline-flex;align-items:baseline;gap:7px;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;font-weight:500;line-height:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-trae-model-name-rate{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;font-weight:400;line-height:16px;flex:none}
/* The two head actions sit together; the probe one SPENDS quota, so it carries
   the hint tooltip rather than looking like its read-only sibling. */
/* The sidebar-credit switch. Two instances share this style: the card's own
   row at the top and the copy beside the model actions (2.9.3). Without it the
   checkbox rendered unstyled and read as absent 鈥?the whole reason the switch
   looked missing. */
.dsm-trae-models-actions{display:flex;align-items:center;gap:8px;flex:none}
.dsm-trae-usage-alternative{display:flex;align-items:flex-start;gap:10px;margin-top:10px;padding:10px 12px;border:1px solid var(--dsw-alias-state-warn-secondary,#fbbf24);border-radius:10px;background:var(--dsw-alias-state-warn-tertiary,#fef3c7)}
.dsm-trae-usage-alternative-text{margin:0;flex:1 1 auto;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-trae-usage-switch-button{flex:0 0 auto;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#2c2f36);color:var(--dsw-alias-label-primary,#e6e6e6);font-size:12px;line-height:16px;cursor:pointer}
.dsm-trae-usage-switch-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dsm-trae-usage-switch-button:disabled{opacity:.5;cursor:not-allowed}
.dsm-trae-usage-note{margin:8px 0 0;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px}
/* Credit-expiry notice, card copy. Three tones by urgency, so the 24-hour case
   cannot be mistaken for the 7-day one at a glance. Reads as an advisory, not
   an error: the account works fine, the credit is simply about to lapse. */
.dsm-trae-expiry{display:flex;flex-direction:column;gap:2px;margin-top:10px;padding:10px 12px;border:1px solid;border-radius:10px;font-size:12px;line-height:18px}
.dsm-trae-expiry-soon{border-color:var(--dsw-alias-state-warn-secondary,#fbbf24);background:var(--dsw-alias-state-warn-tertiary,#fef3c7);color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-trae-expiry-week{border-color:var(--dsw-alias-border-l2,#3a3d45);background:var(--dsw-alias-bg-layer-3,#2c2f36);color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-trae-expiry-lapsed{border-color:var(--dsw-alias-border-l2,#3a3d45);background:var(--dsw-alias-bg-layer-3,#2c2f36);color:var(--dsw-alias-label-tertiary,#999)}
.dsm-trae-expiry-detail{font-size:11px;line-height:16px;opacity:.8}
/* Account import / export (issue #37). A sub-block of the accounts section:
   the transfer row, plus the two dialogs it opens in place. The file input is
   hidden rather than absent — the button opens the system picker, and the input
   must stay mounted to be clicked. */
.dsm-trae-transfer{margin-top:12px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
.dsm-trae-transfer-label{margin:0 0 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,GrayText)}
.dsm-trae-transfer-flat{margin-top:0;padding-top:0;border-top:0}
.dsm-trae-transfer-flat .dsm-trae-transfer-actions{flex-wrap:nowrap}
.dsm-trae-transfer-actions{display:flex;flex-wrap:wrap;gap:8px}
.dsm-trae-transfer-file{display:none}
.dsm-trae-transfer-status{margin:6px 0 0;font-size:11px;line-height:16px}
.dsm-trae-transfer-ok{color:var(--dsw-alias-state-success-primary,#16a34a)}
.dsm-trae-transfer-error{color:var(--dsw-alias-state-error-primary,#dc2626)}
.dsm-trae-transfer-dialog{
  margin-top:8px;padding:10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));
  border-radius:8px;font-size:12px;line-height:18px;
}
.dsm-trae-transfer-dialog>p{margin:0 0 6px}
.dsm-trae-transfer-list{list-style:none;margin:6px 0;padding:0;max-height:180px;overflow:auto}
.dsm-trae-transfer-list label{display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer}
.dsm-trae-transfer-list input{flex:none}
.dsm-trae-transfer-dialog-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
/* A text-button rather than a boxed one: "select all" is a shortcut inside the
   dialog, and a third button would compete with the two that act. */
.dsm-trae-transfer-link{
  margin-top:6px;padding:0;border:0;background:none;cursor:pointer;
  color:var(--dsw-alias-brand-primary,#2563eb);font-size:11px;line-height:16px;
}
.dsm-trae-models-hint{margin:4px 0 0;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px}
/* Bulk context-budget row (issue #42): under the model list, above the
   capability note. Wraps on narrow cards; keeps the two buttons visually a
   pair and distinct from the save footer below. */
.dsm-trae-context-bulk{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
/* Verdict badge. Only a real refusal is coloured as a warning; an unknown
   verdict stays neutral because an inconclusive probe is not evidence against
   the model. */
.dsm-trae-model-probe{flex:none;border-radius:999px;padding:1px 7px;font-size:10px;font-weight:500;line-height:15px;white-space:nowrap}
.dsm-trae-model-probe-available{color:var(--dsw-alias-state-success-primary,#22a06b);border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary,#22a06b) 40%,transparent)}
.dsm-trae-model-probe-gated,.dsm-trae-model-probe-unsupported{color:var(--dsw-alias-state-warn-primary,#f59e0b);border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 40%,transparent)}
.dsm-trae-model-probe-auth{color:var(--dsw-alias-state-error-primary,#d92d20);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#d92d20) 40%,transparent)}
.dsm-trae-model-probe-rate-limited,.dsm-trae-model-probe-unknown{color:var(--dsw-alias-label-tertiary,#999);border:1px solid color-mix(in srgb,var(--dsw-alias-label-tertiary,#999) 35%,transparent)}
/* Promotion capsule (src/promo.ts). Unlike WorkBuddy's badge there is NO
   upstream colour to honour — Trae publishes a pay ratio and nothing else — so
   these three colours are the plugin's own choice, picked only so the kinds stay
   distinguishable at a glance: red = subsidy price, orange = explicitly
   "limited", blue = off-peak hours. */
.dsm-trae-model-promo{flex:none;border-radius:999px;padding:1px 7px;font-size:10px;font-weight:500;line-height:15px;white-space:nowrap;border:1px solid transparent}
.dsm-trae-model-promo-subsidy{color:var(--dsw-alias-state-error-primary,#d92d20);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d92d20) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d92d20) 10%,transparent)}
.dsm-trae-model-promo-limited{color:var(--dsw-alias-state-warn-primary,#f59e0b);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 12%,transparent)}
.dsm-trae-model-promo-offPeak{color:var(--dsw-alias-brand-primary,#5686fe);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#5686fe) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#5686fe) 10%,transparent)}
.dsm-trae-model-meta{display:flex;align-items:center;gap:7px 12px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px}
.dsm-trae-model-options{display:flex;align-items:center;justify-content:flex-end;gap:12px;flex:none}
.dsm-trae-model-image{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:16px;cursor:pointer}
.dsm-trae-model-image input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-trae-context-budget{display:flex;align-items:center;justify-content:flex-end;gap:12px;flex:none;margin:0;padding:0;border:0;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:16px}
.dsm-trae-context-budget label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}
.dsm-trae-context-budget input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-trae-model-capability-note{margin:0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}
.dsm-trae-model-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding-top:12px}
.dsm-trae-model-actions-buttons{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.dsm-trae-usage-cheer{display:inline-flex;align-items:center;gap:4px;flex:none;text-decoration:underline;text-underline-offset:2px;color:var(--dsw-alias-label-tertiary,#999);font-size:13px;line-height:1.5;transition:color .16s}
.dsm-trae-usage-cheer-star{font-size:12px;line-height:1;display:inline-flex}
.dsm-trae-usage-cheer:hover{color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-trae-searched{margin-top:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999)}
.dsm-trae-searched>summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#b8b8b8);user-select:none}
.dsm-trae-searched-hint{margin:6px 0 4px;color:var(--dsw-alias-label-tertiary,#999)}
.dsm-trae-searched-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}
.dsm-trae-searched-list li{display:flex;flex-direction:column;gap:1px;min-width:0}
.dsm-trae-searched-list code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#b8b8b8);word-break:break-all}
.dsm-trae-searched-reason{color:var(--dsw-alias-label-tertiary,#999);font-size:11px}
.dsm-trae-usage-cheer:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}
.dsm-trae-checkin{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:14px;background:var(--dsw-alias-bg-layer-2,#24262c)}
.dsm-trae-checkin-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsm-trae-checkin-label{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;line-height:18px;font-weight:600}
.dsm-trae-checkin-hint{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:17px}
.dsm-trae-checkin-button{flex:none}
/* The "this machine already used today's check-in" note is INFORMATIONAL, not
   an error: it is Trae's one-per-device-per-day rule, and the day is simply
   spent. Rendering it in the error colour would read as a plugin fault. */
.dsm-trae-checkin-note{margin:8px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
/* The busy veil: one overlay for every account write whose result only lands
   after the Host re-reads its settings document. Fixed so it covers the card
   no matter which section started the operation, and translucent so the table
   stays visible underneath — the user is watching a specific row change, and
   hiding it would defeat the point.

   The mask and card surface are the HOST's own tokens, not this file's
   invention. --dsw-alias-bg-mask-1 + --dsw-mask-blur is exactly what the
   host's own overlays use, so the veil dims the way every other overlay in the
   shell does instead of laying its own black wash on top. A hardcoded flat
   black mask (e.g. a mid-transparency black) was tuned against neither theme:
   too weak next to the host's .24 mask in light mode, and it ignored the
   host's blur entirely.

   bg-layer-2 (not bg-primary, which does not exist in the host's token set at
   all and therefore always fell through to this file's near-black #1b1c20) is
   the same surface the host puts behind its panels — that near-black fallback
   is what made the veil read as a black slab with unreadable text on it. */
.dsm-trae-veil{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.32));backdrop-filter:var(--dsw-mask-blur);cursor:progress}
/* --dsw-elevation-prominent is the host's own panel shadow (a hairline stroke
   plus two soft layers); a hand-rolled drop shadow read as a heavy grey box. */
.dsm-trae-veil-card{display:flex;flex-direction:column;align-items:center;gap:8px;max-width:min(340px,80vw);padding:16px 20px;border:1px solid var(--dsw-alias-border-l2,#0000001a);border-radius:12px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-elevation-prominent,0 8px 28px rgba(0,0,0,.35))}
.dsm-trae-veil-text{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#0f1115);text-align:center}
/* label-secondary, not label-tertiary: this line carries the operation's
   detail and must stay legible. tertiary is the host's dimmest tier
   (neutral-bluish-600 on light, neutral-bluish-400 on dark) and is meant for
   metadata, not for a sentence the user has to read while waiting. */
.dsm-trae-veil-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#61666b);text-align:center}
/* The spinner proves the UI is alive when the row under it has not changed yet
   — which is precisely the confusion the veil exists to remove. It follows the
   host's own state spinner (dsh's _dsh-state-dot-spin): an SVG arc whose dash
   breathes while it turns, currentColor so it inherits the tier it sits in,
   and the same 1.5s beat. The previous 18px border-ring at .7s was roughly
   twice the host's speed and visibly out of step with every other spinner in
   the shell — that mismatch, more than the shape itself, is what made it look
   cheap.

   Reduced-motion users get the static arc rather than a frozen ring, matching
   how the host degrades its own spinner. */
.dsm-trae-veil-spinner{width:20px;height:20px;color:var(--dsw-alias-label-secondary,#61666b);animation:dsm-trae-veil-spin 1.5s linear infinite}
.dsm-trae-veil-spinner-track{opacity:.25}
.dsm-trae-veil-spinner-arc{stroke-dasharray:12 150;animation:dsm-trae-veil-dash 1.5s ease-in-out infinite}
@keyframes dsm-trae-veil-spin{to{transform:rotate(360deg)}}
@keyframes dsm-trae-veil-dash{0%{stroke-dasharray:12 150;stroke-dashoffset:0}50%{stroke-dasharray:24 150;stroke-dashoffset:-6}to{stroke-dasharray:12 150;stroke-dashoffset:0}}
@media (prefers-reduced-motion: reduce){.dsm-trae-veil-spinner{animation:none}.dsm-trae-veil-spinner-arc{animation:none;stroke-dasharray:18 150;stroke-dashoffset:-3}}

/* ------------------------------------------------------------------ *
 * The account pool (3.9.0).                                           *
 *                                                                     *
 * Five tracks, because the table answers "which accounts, and what is  *
 * each one worth right now" — a single picker could only ever show the *
 * one already chosen, and every field here is a reason to include or   *
 * exclude a row. The check-in track is CONDITIONAL (only the CN panel  *
 * grants a daily reward), so the actions cell is pinned to the LAST    *
 * track (grid-column:-2/-1) rather than to the fifth one: otherwise     *
 * a four-cell row would drop Test/Remove into the check-in slot and    *
 * leave a hole on the right.                                          *
 * ------------------------------------------------------------------ */
.dsm-trae-pool{--dsm-trae-pool-pad-x:14px;--dsm-trae-pool-pad-y:10px;--dsm-trae-pool-radius:14px;display:flex;flex-direction:column;gap:12px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding:14px 0 0}
.dsm-trae-pool-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.dsm-trae-pool-title{margin:0;font-size:13px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-trae-pool-region-note{margin:3px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-trae-pool-current{flex:none;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#c6c9d0);white-space:nowrap}
/* Two classes on the element (settings + modebar): a single-class rule here loses
   to .dsm-trae-pool-settings further down, which resets padding to 0 and repaints
   the background. Match both classes so the strip keeps its own frame. */
.dsm-trae-pool-settings.dsm-trae-pool-modebar{padding:12px 14px;gap:8px;border-color:rgba(86,134,254,.36);background:linear-gradient(180deg,rgba(86,134,254,.10),rgba(86,134,254,.02)),var(--dsw-alias-bg-layer-2,#24262c)}
.dsm-trae-pool-modebar-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dsm-trae-pool-modebar-label{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-trae-pool-modebar-state{flex:none;padding:1px 9px;border-radius:999px;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-brand-primary,#5686fe);background:rgba(86,134,254,.14);border:1px solid rgba(86,134,254,.3)}
.dsm-trae-pool-modebar .dsm-trae-pool-dirty{margin-left:auto}
.dsm-trae-pool-modebar .dsm-trae-pool-note{line-height:18px}
/* Modifier rules must out-specify their base class wherever the base is defined
   further down (.dsm-trae-pool-note, .dsm-trae-select): matching both classes keeps
   the warn tone and the wider select from being reset by the later base rule. */
.dsm-trae-pool-note.dsm-trae-pool-serving-note{color:var(--dsw-alias-state-warn-primary,#b45309)}
.dsm-trae-pool-card .dsm-trae-pool-actions{padding:0 var(--dsm-trae-pool-pad-x) 12px}
.dsm-trae-pool-card .dsm-trae-pool-action-note{padding:0 var(--dsm-trae-pool-pad-x) 12px}
.dsm-trae-pool-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.dsm-trae-pool-action-checkin{flex:none;white-space:nowrap}
.dsm-trae-pool-action-test{flex:none;white-space:nowrap}
/* Reference text, folded away. Same <details>/<summary> shape as the WorkBuddy
   sibling's "how the pool picks an account": keyboard-operable and
   screen-reader-expanded natively, and nothing to keep in sync in state. The
   paragraphs inside are plain .dsm-trae-pool-note - the container only supplies
   the frame, so their own type scale stays authoritative. */
.dsm-trae-pool-more{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));border-radius:10px;background:var(--dsw-alias-bg-layer-2,#24262c);overflow:hidden}
.dsm-trae-pool-more-summary{padding:8px 12px;cursor:pointer;user-select:none;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;font-weight:600;line-height:18px}
.dsm-trae-pool-more-summary:hover{color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-trae-pool-more-summary:focus-visible{outline:2px solid rgba(86,134,254,.55);outline-offset:-2px}
.dsm-trae-pool-more-body{display:flex;flex-direction:column;gap:8px;padding:10px 12px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}
/* Removing an account from the pool is destructive (it drops THIS panel's saved
   membership), so the hover state takes the error tone rather than the neutral
   one every other outline button gets. */
/* The destructive Delete is visually heavier than 移除 from the start (error
   colour idle), so the row shows two distinct actions instead of two greys. */
.dsm-trae-pool-delete{color:var(--dsw-alias-state-error-primary,#d92d20)}
.dsm-trae-pool-delete:hover:not(:disabled){background:rgba(217,45,32,.08)}
.dsm-trae-pool-delete-hint{margin:0;padding:8px var(--dsm-trae-pool-pad-x);border:1px solid var(--dsw-alias-state-error-primary,#d92d20);border-radius:10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0);background:var(--dsw-alias-bg-layer-3,#2a2c33)}
.dsm-trae-pool-busy{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-trae-pool-action-note{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-trae-pool-card{display:flex;flex-direction:column;min-width:0;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:var(--dsm-trae-pool-radius);background:var(--dsw-alias-bg-layer-2,#24262c);overflow:hidden}
.dsm-trae-pool-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px var(--dsm-trae-pool-pad-x) 12px}
.dsm-trae-pool-card-title{margin:0;font-size:13px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-trae-pool-card-tools{display:flex;align-items:center;gap:8px;flex:none}
.dsm-trae-pool-count{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-trae-pool-card .dsm-trae-pool-table{border:0;border-radius:0;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}
.dsm-trae-pool-members{display:flex;flex-direction:column;gap:10px}
/* Prose, not a box. Every explanation in this section is one line of muted
   text; boxing each one is what made the block look like a stack of cards. */
.dsm-trae-pool-actions-end{margin-inline-start:auto}
.dsm-trae-pool-credit-meta{display:block;margin-top:2px;font-size:11px;line-height:16px;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-trae-pool-account-note{grid-column:2;grid-row:3;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-trae-pool-tools-dashed{border:1px dashed var(--dsw-alias-border-l2,#3a3d45);border-radius:var(--dsm-trae-pool-radius);padding:var(--dsm-trae-pool-pad-y) var(--dsm-trae-pool-pad-x)}
.dsm-trae-pool-tool-label{margin-inline-end:auto;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-trae-pool-note{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
/* A setting row: label + hint on the left, the control on the right, one
   rhythm for the switch, the target select and the manual binding. */
.dsm-trae-pool-set{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:var(--dsm-trae-pool-pad-y) var(--dsm-trae-pool-pad-x);border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}
.dsm-trae-pool-set:first-child{border-top:0}
.dsm-trae-pool-set-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.dsm-trae-pool-set-copy b{font-size:13px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-trae-pool-set-copy span{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-trae-pool-set-ctl{display:flex;align-items:center;gap:8px;flex:none}
.dsm-trae-pool-set-ctl select{min-width:180px}
.dsm-trae-select.dsm-trae-pool-account-select{min-width:180px;max-width:min(320px,50%)}
.dsm-trae-pool-tools{display:flex;flex-direction:column;gap:8px}
.dsm-trae-pool-tool-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-trae-pool-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a8);white-space:nowrap}
.dsm-trae-pool-warn-tag{padding:0 6px;border-radius:999px;font-size:11px;line-height:16px;white-space:nowrap}
.dsm-trae-pool-warn-tag-soon{color:var(--dsw-alias-state-warn-primary,#b45309)}
.dsm-trae-pool-warn-tag-lapsed{color:var(--dsw-alias-state-error-primary,#d92d20)}
.dsm-trae-pool-claim{padding:2px 8px;font-size:12px;line-height:16px}
.dsm-trae-pool-settings-wrap{display:flex;flex-direction:column;gap:10px}

.dsm-trae-pool-settings{display:flex;flex-direction:column;gap:0;padding:0;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:var(--dsm-trae-pool-radius);overflow:hidden;background:var(--dsw-alias-bg-layer-2,#24262c)}
.dsm-trae-pool-members-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.dsm-trae-pool-settings-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.dsm-trae-pool-subtitle{margin:0;font-size:12px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary,#e6e6e6)}
.dsm-trae-pool-subnote{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-trae-pool-select-actions{display:flex;flex:none;gap:6px}
.dsm-trae-pool-select-actions .dsm-btn,.dsm-trae-pool-row-actions .dsm-btn{padding:4px 10px;font-size:12px;line-height:1.4}
.dsm-trae-pool-table{--dsm-trae-pool-cols:minmax(0,1.4fr) 128px minmax(0,1.2fr) 96px 128px;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:var(--dsm-trae-pool-radius);overflow:hidden;background:var(--dsw-alias-bg-layer-2,#24262c)}
.dsm-trae-pool-table-no-checkin{--dsm-trae-pool-cols:minmax(0,1.4fr) 128px minmax(0,1.2fr) 128px}
.dsm-trae-pool-row{display:grid;grid-template-columns:var(--dsm-trae-pool-cols);align-items:start;gap:10px;padding:var(--dsm-trae-pool-pad-y) var(--dsm-trae-pool-pad-x);border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}
.dsm-trae-pool-row:first-child{border-top:0}
/* The header carries labels for the first three tracks only: the check-in and
   action cells are self-describing ("Not checked in", "Test"), and a header word
   for an empty cell would be a promise the table does not keep. */
.dsm-trae-pool-col-account{padding-inline-start:23px}
.dsm-trae-pool-row-head{align-items:center;padding:8px var(--dsm-trae-pool-pad-x);border-top:0;background:var(--dsw-alias-bg-layer-3,#2a2c33);font-size:11px;line-height:16px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
/* The row that would bill the next request. Tinted, not bordered: a border here
   reads as a selection control, and the checkbox beside it already is one. */
.dsm-trae-pool-row-current{background:rgba(86,134,254,.07);box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary,#5686fe)}
.dsm-trae-pool-row-ghost{opacity:.7}
.dsm-trae-pool-row-actions{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}
.dsm-trae-pool-account{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:2px 8px;min-width:0}
.dsm-trae-pool-check{display:inline-flex;align-items:center;flex:none;grid-column:1;grid-row:1;cursor:pointer}
.dsm-trae-pool-check input{flex:none;margin:0;cursor:pointer;accent-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-trae-pool-check:has(input:disabled){opacity:.6;cursor:default}
.dsm-trae-pool-account-name{display:flex;align-items:center;gap:6px;min-width:0;grid-column:2;grid-row:1;font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary,#e6e6e6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-trae-pool-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-dimmed,#777)}
.dsm-trae-pool-dot-ok{background:var(--dsw-alias-state-success-primary,#12b76a)}
.dsm-trae-pool-dot-excluded{background:var(--dsw-alias-state-warn-primary,#b45309)}
.dsm-trae-pool-dot-ghost{background:var(--dsw-alias-label-dimmed,#777)}
.dsm-trae-pool-account-tags{display:flex;flex-wrap:wrap;align-items:center;gap:6px;grid-column:2;grid-row:2;min-width:0}
.dsm-trae-pool-tag{padding:0 6px;border-radius:999px;font-size:10px;line-height:16px;white-space:nowrap}
.dsm-trae-pool-member{font-size:11px;line-height:16px;color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-trae-pool-not-member{font-size:11px;line-height:16px;color:var(--dsw-alias-label-dimmed,#9aa0a6)}
.dsm-trae-pool-tag-member{border:1px solid var(--dsw-alias-border-l2,#3a3d45);color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-trae-pool-tag-excluded{background:var(--dsw-alias-state-warn-tertiary,#fef3c7);color:var(--dsw-alias-state-warn-primary,#b45309)}
.dsm-trae-pool-tag-ghost{border:1px dashed var(--dsw-alias-border-l2,#3a3d45);color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-trae-pool-credit{display:flex;flex-direction:column;gap:1px;min-width:0}
.dsm-trae-pool-credit-num{font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary,#e6e6e6);font-variant-numeric:tabular-nums}
.dsm-trae-pool-credit-label{font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-trae-pool-probe{min-width:0}
.dsm-trae-pool-probe-cell{display:flex;flex-direction:column;gap:1px;min-width:0}
.dsm-trae-pool-probe-outcome{display:flex;align-items:center;gap:5px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-trae-pool-probe-ok{color:var(--dsw-alias-state-success-primary,#12b76a)}
.dsm-trae-pool-probe-warn{color:var(--dsw-alias-state-warn-primary,#b45309)}
.dsm-trae-pool-probe-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-trae-pool-probe-detail{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#9aa0a8);overflow-wrap:anywhere}
.dsm-trae-pool-probe-none{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-trae-pool-checkin{min-width:0}
.dsm-trae-pool-checkin-state{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-trae-pool-checkin-ok{color:var(--dsw-alias-state-success-primary,#12b76a)}
.dsm-trae-pool-checkin-no{color:var(--dsw-alias-state-warn-primary,#b45309)}
/* "Unknown" and "device already claimed" are facts, not faults: a muted line
   says so without dressing either one up as an error. */
.dsm-trae-pool-checkin-unknown{color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-trae-pool-checkin-device{color:var(--dsw-alias-label-tertiary,#9aa0a8)}
/* The advisory lines share one shape (a quiet bordered box): each is a fact the
   user may need to act on, none of them is an error, and five different
   rectangles in one section would read as five different severities. */
.dsm-trae-pool-ghost-note{margin:0;padding:8px var(--dsm-trae-pool-pad-x);border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0);background:var(--dsw-alias-bg-layer-3,#2a2c33)}
.dsm-trae-pool-unsaved{margin:0;padding:8px var(--dsm-trae-pool-pad-x);border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0);background:var(--dsw-alias-bg-layer-3,#2a2c33)}
.dsm-trae-pool-off-notice{margin:0;padding:0 var(--dsm-trae-pool-pad-x) 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary,#b45309)}
.dsm-trae-pool-target-none{margin:0;padding:0 12px 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary,#b45309)}
.dsm-trae-pool-target-stale{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 var(--dsm-trae-pool-pad-x);padding-bottom:10px;color:var(--dsw-alias-state-warn-primary,#b45309)}
.dsm-trae-pool-warning{display:flex;flex-direction:column;gap:2px;padding:8px var(--dsm-trae-pool-pad-x);border:1px solid var(--dsw-alias-state-warn-secondary,#fbbf24);border-radius:10px;background:var(--dsw-alias-state-warn-tertiary,#fef3c7);color:var(--dsw-alias-state-warn-primary,#b45309);font-size:12px;line-height:18px}
.dsm-trae-pool-warning-title{font-weight:600}
.dsm-trae-pool-warning-hint{opacity:.85}
/* "Empty" is an unfinished setup, not a fault: neutral tone. */
.dsm-trae-pool-warning-empty{border-color:var(--dsw-alias-border-l2,#3a3d45);background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-secondary,#c6c9d0)}
/* "Every member is unusable" is the one case that IS the pool's fault, so it
   keeps the warn tone the base class sets. */
.dsm-trae-pool-warning-unusable{border-color:var(--dsw-alias-state-warn-secondary,#fbbf24);background:var(--dsw-alias-state-warn-tertiary,#fef3c7);color:var(--dsw-alias-state-warn-primary,#b45309)}
.dsm-trae-pool-save-row{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding-top:12px;position:sticky;bottom:0;z-index:2;padding-bottom:8px;background:var(--dsw-alias-bg-layer-3,#2a2c33)}
.dsm-trae-pool-save-buttons{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.dsm-trae-pool-save-row .dsm-btn{padding:5px 14px;font-size:13px;line-height:1.5}
.dsm-trae-pool-dirty{padding:0 6px;border-radius:999px;background:var(--dsw-alias-state-warn-tertiary,#fef3c7);color:var(--dsw-alias-state-warn-primary,#b45309);font-size:10px;line-height:16px}
.dsm-trae-pool-save-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#d92d20)}
.dsm-trae-pool-target{display:flex;flex-direction:column;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-trae-pool-target-label{color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-trae-select{max-width:220px;padding:2px 6px;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary,#e6e6e6);background:var(--dsw-alias-bg-layer-3,#2a2c33);border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:8px}
.dsm-trae-select:disabled{opacity:.6;cursor:default}
.dsm-trae-pool-log{display:flex;flex-direction:column;gap:6px;padding-top:2px}
.dsm-trae-pool-log-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.dsm-trae-pool-log-empty{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-trae-pool-log-list{display:flex;flex-direction:column;gap:3px;margin:0;padding:0;list-style:none;max-height:160px;overflow-y:auto}
.dsm-trae-pool-log-item{padding:0 0 0 8px;border-left:2px solid var(--dsw-alias-border-l2,#3a3d45);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-trae-pool-log-info{border-left-color:var(--dsw-alias-border-l2,#3a3d45)}
.dsm-trae-pool-log-ok{border-left-color:var(--dsw-alias-state-success-primary,#12b76a)}
.dsm-trae-pool-log-warn{border-left-color:var(--dsw-alias-state-warn-primary,#b45309)}
.dsm-trae-pool-log-error{border-left-color:var(--dsw-alias-state-error-primary,#d92d20)}
.dsm-trae-pool-log-text{overflow-wrap:anywhere}
`


/**
 * Composer-row readout styles, injected by the readout itself.
 *
 * SEPARATE from `TRAE_CARD_CSS`, and that is not tidiness: the card's CSS is
 * only injected when the settings card module loads, so putting the composer's
 * rules in it means the readout renders UNSTYLED in the composer toolbar 鈥?
 * which is exactly what shipped in 2.13.0鈥?.13.4. The trigger fell back to the
 * browser's default button box, and the panel, without `position: fixed`, had
 * its inline left/top ignored and rendered nowhere useful.
 *
 * `tests/composer-styles.spec.tsx` now asserts that every class this component
 * renders has a rule here, so a rule cannot go missing without a test failing.
 */
export const COMPOSER_POINTS_CSS = `
/* The readout is plain composer text 鈥?no border, no fill at rest. The padding
   is only the click target, invisible until the pointer arrives. */
.dsm-trae-composer-points{display:inline-flex;align-items:center;min-width:0}
.dsm-trae-composer-points-trigger{
  appearance:none;display:inline-flex;align-items:center;align-self:stretch;
  padding:2px 6px;border:0;border-radius:6px;background:transparent;
  /* EXPLICIT, not inherit. The composer row's own font and body colour are
     noticeably larger and darker than the neighbouring controls 鈥?a credit
     readout is secondary information and must not shout. 12px matches this
     plugin's original line; label-tertiary matches the shell's own composer-row
     control (ContextMeter), which is the sibling this reads alongside. */
  font-size:12px;line-height:18px;
  color:var(--dsw-alias-label-tertiary,#999);
  white-space:nowrap;cursor:pointer;
  font-variant-numeric:tabular-nums;
}
.dsm-trae-composer-points-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dsm-trae-composer-points-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
/* The panel is portaled to document.body and positioned from the trigger, so it
   MUST be fixed 鈥?otherwise the left/top it measures are ignored and it lands in
   document flow. All material comes from shell tokens so it follows the theme. */
.dsm-trae-composer-panel{
  position:fixed;z-index:1100;box-sizing:border-box;
  width:min(248px,calc(100vw - 24px));padding:12px;
  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));
  border-radius:var(--dsw-radius-lg,14px);
  background:var(--dsw-specific-menu,Canvas);
  box-shadow:var(--dsw-elevation-prominent,0 8px 32px rgba(0,0,0,.22));
  backdrop-filter:var(--dsw-menu-backdrop-filter,none);
  font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#444);
}
.dsm-trae-composer-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.dsm-trae-composer-panel-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,CanvasText)}
/* Self-contained: the dsm-btn primitive lives in TRAE_CARD_CSS, which the
   composer never loads, so the refresh button must style itself. */
.dsm-trae-composer-panel-refresh{
  appearance:none;flex:none;margin-left:auto;padding:3px 10px;
  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.34));
  border-radius:7px;background:transparent;
  color:var(--dsw-alias-label-secondary,#444);
  font:inherit;font-size:11px;line-height:16px;cursor:pointer;
}
.dsm-trae-composer-panel-refresh:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.6));color:var(--dsw-alias-label-primary,CanvasText)}
.dsm-trae-composer-panel-refresh:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-trae-composer-panel-refresh:disabled{opacity:.5;cursor:default}
/* The panel is a TABLE: one row per account in the region, one figure (the
   general balance) per row, and a row click switches accounts.

   Rhythm is deliberate: the header sits on a hairline, the switch button owns
   ALL horizontal padding (and pulls back by the same amount so its label lines
   up with the header), and every row is the same height. A misaligned first
   column is what makes a two-column popover read as broken. */
.dsm-trae-composer-panel-table{
  width:100%;border-collapse:collapse;
  font-size:12px;line-height:18px;
}
.dsm-trae-composer-panel-table thead th{
  padding:0 0 7px;font-weight:500;text-align:left;font-size:11px;
  color:var(--dsw-alias-label-tertiary,GrayText);
  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));
}
.dsm-trae-composer-panel-num{
  text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;
}
.dsm-trae-composer-panel-table thead th.dsm-trae-composer-panel-num{padding-right:0}
.dsm-trae-composer-panel-table tbody th{
  padding:0;font-weight:400;text-align:left;vertical-align:middle;
}
.dsm-trae-composer-panel-table tbody td{
  padding:4px 0;vertical-align:middle;
  color:var(--dsw-alias-label-primary,CanvasText);
}
/* The current account reads as current without shouting: a filled dot and a
   slightly heavier weight. Disabled 鈥?pressing it would write a selection that
   has not changed. */
.dsm-trae-composer-panel-table tbody tr.dsm-trae-composer-panel-row-current td{font-weight:600}
.dsm-trae-composer-panel-switch{
  appearance:none;display:flex;align-items:center;gap:7px;
  width:100%;padding:4px 6px;margin-left:-6px;
  border:0;border-radius:6px;background:transparent;
  color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer;
  white-space:nowrap;overflow:hidden;
}
.dsm-trae-composer-panel-switch>span:last-child{overflow:hidden;text-overflow:ellipsis}
/* Hover belongs to the switch, not the row: the number cell is not clickable,
   so lighting it up would promise an action it cannot perform. */
.dsm-trae-composer-panel-switch:hover:not(:disabled){
  background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));
}
.dsm-trae-composer-panel-switch:focus-visible{
  outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:-1px;
}
.dsm-trae-composer-panel-switch:disabled{cursor:default}
.dsm-trae-composer-panel-dot{
  flex:none;width:7px;height:7px;border-radius:50%;
  background:var(--dsw-alias-label-dimmed,rgba(127,127,127,.5));
}
.dsm-trae-composer-panel-table tr.dsm-trae-composer-panel-row-current .dsm-trae-composer-panel-dot{
  background:var(--dsw-alias-state-success-primary,#22c55e);
}
.dsm-trae-composer-panel-foot{
  display:flex;justify-content:space-between;gap:8px;
  margin-top:9px;padding-top:7px;
  border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));
  font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,GrayText);
}
.dsm-trae-composer-panel-empty{margin:0;color:var(--dsw-alias-label-tertiary,GrayText)}
.dsm-trae-composer-panel-error{margin:8px 0 0;color:var(--dsw-alias-state-error-primary,#d92d20);font-size:11px;line-height:16px}
/* Credit-expiry notice. Three tones by urgency, so the 24-hour case cannot be
   mistaken for the 7-day one at a glance. Reads as an advisory, not an error:
   the account works fine, the credit is simply about to lapse. */
.dsm-trae-expiry{
  display:flex;flex-direction:column;gap:2px;
  margin-top:9px;padding:8px 10px;border:1px solid;border-radius:8px;
  font-size:11px;line-height:16px;
}
.dsm-trae-expiry-soon{
  border-color:var(--dsw-alias-state-warn-secondary,#fbbf24);
  background:var(--dsw-alias-state-warn-tertiary,#fef3c7);
  color:var(--dsw-alias-label-primary,#1f2329);
}
.dsm-trae-expiry-week{
  border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.36));
  background:transparent;
  color:var(--dsw-alias-label-secondary,GrayText);
}
.dsm-trae-expiry-lapsed{
  border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.36));
  background:transparent;
  color:var(--dsw-alias-label-tertiary,GrayText);
}
.dsm-trae-expiry-detail{font-size:11px;line-height:16px;opacity:.85}
`
