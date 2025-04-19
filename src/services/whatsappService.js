import axios from 'axios';
import config from '../config/env.js';

class WhatsAppService {
  async sendMessage(to, body, messageId = null) {
    try {
      if (!body || typeof body !== "string" || body.trim() === "") {
        throw new Error("El parámetro 'body' debe ser un string no vacío.");
      }
  
      const data = {
        messaging_product: 'whatsapp',
        to,
        text: { body }
      };
  
      if (messageId) {
        data.context = { message_id: messageId };
      }
  
      await axios.post(
        `https://graph.facebook.com/v22.0/591259317412047/messages`,
        data,
        {
          headers: {
            Authorization: `Bearer ${config.API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('Error sending message:', error.response?.data || error.message);
    }
  }
  

  async markAsRead(messageId) {
    if (!messageId) {
      console.error('Error marking message as read: messageId is required');
      return;
    }
    try {
      await axios.post(
        `https://graph.facebook.com/v22.0/591259317412047/messages`,
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId
        },
        {
          headers: {
            Authorization: `Bearer ${config.API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('Error marking message as read:', error.response?.data || error.message);
    }
  }

  async sendInteractiveButtons(to, bodyText, buttons) 
  
  
  
  {
    if (!buttons || !Array.isArray(buttons) || buttons.length === 0) {
      console.error('Error sending interactive buttons: buttons array is required');
      return;
    }
    try {
      await axios.post(
        `https://graph.facebook.com/v22.0/591259317412047/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: bodyText },
            action: { buttons }
          }
        },
        {
          headers: {
            Authorization: `Bearer ${config.API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('Error sending interactive buttons:', error.response?.data || error.message);
    }
  }

  async sendMediaMessage(to, type, mediaUrl, caption) {
    try{
      const mediaObject = {}

      switch(type){
        case "image":
          mediaObject.image ={link: mediaUrl, caption: caption};
          break;
        case "audio":
            mediaObject.audio ={ link:mediaUrl};
          break;
        case "video":
              mediaObject.video = { link: mediaUrl, caption: caption};
            break;
        case "document":
                mediaObject.document={link: mediaUrl, caption: caption, filename: "GymBro.pdf"};
              break;

        default:
          throw new Error ("Not soported Media Type");
            
      }
      await axios.post(
        `https://graph.facebook.com/v22.0/591259317412047/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: type,
          ...mediaObject
        },
        {
          headers: {
            Authorization: `Bearer ${config.API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      

    } catch(error) {
      console.error("Error sending Media;", error);

    }
  }







}

export default new WhatsAppService();


