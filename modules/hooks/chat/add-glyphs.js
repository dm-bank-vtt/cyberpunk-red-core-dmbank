import CPRChat from "../../chat/cpr-chat.js";

const AddGlyphs = () => {
  /**
   * Enables listeners so that clickable damage glyphs work.
   *
   * Foundry V13+ fires `renderChatMessageHTML` with a plain HTMLElement (the old jQuery based
   * `renderChatMessage` hook is deprecated), so we wrap the element for our jQuery based code.
   *
   * @public
   * @memberof hookEvents
   * @param {ChatMessage} message - the chat message being rendered
   * @param {HTMLElement} element - the HTML DOM of the chat card
   */
  Hooks.on("renderChatMessageHTML", async (message, element) => {
    const html = $(element);
    const messageData = {
      message: {
        whisper: Array.from(message.whisper ?? []),
        blind: message.blind ?? false,
        author: message.author?.id ?? message._source?.author,
      },
    };
    CPRChat.chatListeners(html);
    CPRChat.addMessageTags(html, messageData);
  });
};

export default AddGlyphs;
