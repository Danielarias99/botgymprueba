import config from '../config/env.js';
import messageHandler from '../services/messageHandler.js';

class WebhookController {
  async handleIncoming(req, res) {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    const senderInfo = value?.contacts?.[0];
  
    console.log('📥 Webhook recibido:', JSON.stringify(req.body, null, 2));
  
    // Solo procesar mensajes de texto enviados por el usuario (no eventos de estado)
    if (message && !value.statuses) {
      await messageHandler.handleIncomingMessage(message, senderInfo);
    }
    
  
    res.sendStatus(200);
  }
  

  verifyWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.WEBHOOK_VERIFY_TOKEN) {
      res.status(200).send(challenge);
      console.log('Webhook verified successfully!');
    } else {
      res.sendStatus(403);
    }
  }
}

export default new WebhookController();