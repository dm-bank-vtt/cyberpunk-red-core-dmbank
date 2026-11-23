const HideBlindRolls = () => {
  /**
   * Do not display "Blind" chat cards to non-gm. Foundry doesn't hide the content of blind
   * chat messages that are not rolls, so this is how we get around that.
   *
   * @public
   * @memberof hookEvents
   * @param {ChatMessage} message - the chat message being rendered
   * @param {HTMLElement} element - the HTML DOM of the chat card
   */
  Hooks.on("renderChatMessageHTML", async (message, element) => {
    if (game.user.isGM) return;
    const html = $(element);
    if (message.blind || html.hasClass("blind")) {
      // Remove header so Foundry does not attempt to update its timestamp
      html.find(".message-header").remove();
      html.html("").css("display", "none");
    }
  });
};

export default HideBlindRolls;
