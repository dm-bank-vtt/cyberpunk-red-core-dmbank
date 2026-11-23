/**
 * Tiny ApplicationV2 base for the NET windows: render a HTML string, delegate clicks.
 */
const { ApplicationV2 } = foundry.applications.api;

export default class NetWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["nc-netwin"],
    window: { resizable: true },
    position: { width: 860, height: 680 },
  };

  /** @abstract */
  async buildHTML() {
    return "";
  }

  async _renderHTML() {
    return this.buildHTML();
  }

  _replaceHTML(result, content) {
    const scroll = content.querySelector("[data-keep-scroll]")?.scrollTop;
    content.innerHTML = result;
    if (scroll) {
      const el = content.querySelector("[data-keep-scroll]");
      if (el) el.scrollTop = scroll;
    }
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // The window element is rebuilt every time the app is closed and opened again,
    // so wire each new element once (not once per app instance).
    if (this._wiredEl === this.element) return;
    this._wiredEl = this.element;
    this.element.addEventListener("click", (ev) => {
      const el = ev.target.closest("[data-a]");
      if (!el || el.hasAttribute("disabled")) return;
      ev.preventDefault();
      this.onAction(el.dataset.a, el, ev);
    });
    this.element.addEventListener("change", (ev) => this.onInput?.(ev.target, ev));
  }

  /** @abstract */
  onAction() {}
}
