import config from '../config/env.js';
import messageHandler from '../services/messageHandler.js';

class WebhookController {
  async handleIncoming(req, res) {
    try {
      console.log('📥 Webhook recibido:', JSON.stringify(req.body, null, 2));

      // Verificar si el objeto está en español o inglés
      if (!req.body.objeto && !req.body.object) {
        console.log('❌ No se encontró objeto en el webhook');
        return res.sendStatus(200);
      }

      // Adaptación para manejar campos en español
      const entrada = req.body.entrada || req.body.entry;
      if (!entrada || !Array.isArray(entrada) || entrada.length === 0) {
        console.log('❌ No se encontró entrada en el webhook');
        return res.sendStatus(200);
      }

      const primerEntrada = entrada[0];
      const cambios = primerEntrada.cambios || primerEntrada.changes;
      
      if (!cambios || !Array.isArray(cambios) || cambios.length === 0) {
        console.log('❌ No se encontró cambios en el webhook');
        return res.sendStatus(200);
      }

      const primerCambio = cambios[0];
      const valor = primerCambio.valor || primerCambio.value;

      if (!valor) {
        console.log('❌ No se encontró valor en el webhook');
        return res.sendStatus(200);
      }

      console.log('🔍 Procesando valor:', JSON.stringify(valor, null, 2));

      // ---> AGREGAR ESTE LOG AQUÍ <--- 
      const incomingPhoneNumberId = valor?.metadata?.phone_number_id;
      console.log("📞 Phone Number ID entrante:", incomingPhoneNumberId);

      // ---> AGREGAR ESTA VALIDACIÓN <--- 
      if (incomingPhoneNumberId !== config.BUSINESS_PHONE) {
        console.log(`🚫 Ignorando webhook. ID entrante (${incomingPhoneNumberId}) no coincide con BUSINESS_PHONE configurado (${config.BUSINESS_PHONE}).`);
        return res.sendStatus(200); // Importante responder OK para que Meta no reintente
      }

      // Extraer mensaje y contacto (manejando nombres en español e inglés)
      const mensajes = valor.mensajes || valor.messages;
      const contactos = valor.contactos || valor.contacts;
      const estados = valor.estados || valor.statuses;

      if (estados && estados[0]) {
        console.log('📊 Estado del mensaje:', JSON.stringify(estados[0], null, 2));
        return res.sendStatus(200);
      }

      if (!mensajes || !Array.isArray(mensajes) || mensajes.length === 0) {
        console.log('❌ No se encontró mensajes en el webhook');
        return res.sendStatus(200);
      }

      const mensaje = mensajes[0];
      const contacto = contactos && contactos[0];

      // Adaptar el formato del mensaje
      const adaptedMessage = {
        from: mensaje.from || mensaje.de,
        id: mensaje.id,
        timestamp: mensaje.timestamp || mensaje["marca de tiempo"],
        type: mensaje.type || mensaje.tipo,
        text: mensaje.text || (mensaje.texto ? {
          body: mensaje.texto.cuerpo || mensaje.texto.body
        } : undefined),
        interactive: mensaje.interactive || mensaje.interactivo ? {
          type: (mensaje.interactive || mensaje.interactivo).type || (mensaje.interactive || mensaje.interactivo).tipo,
          button_reply: (mensaje.interactive || mensaje.interactivo).button_reply || (mensaje.interactive || mensaje.interactivo).respuesta_boton ? {
            id: ((mensaje.interactive || mensaje.interactivo).button_reply || (mensaje.interactive || mensaje.interactivo).respuesta_boton).id,
            title: ((mensaje.interactive || mensaje.interactivo).button_reply || (mensaje.interactive || mensaje.interactivo).respuesta_boton).title || ((mensaje.interactive || mensaje.interactivo).button_reply || (mensaje.interactive || mensaje.interactivo).respuesta_boton).titulo
          } : undefined
        } : undefined
      };

      const adaptedSenderInfo = contacto ? {
        profile: {
          name: contacto.profile?.name || contacto.perfil?.nombre
        },
        wa_id: contacto.wa_id
      } : undefined;

      console.log('🔄 Procesando mensaje adaptado:', JSON.stringify(adaptedMessage, null, 2));
      console.log('👤 Información del remitente:', JSON.stringify(adaptedSenderInfo, null, 2));

      await messageHandler.handleIncomingMessage(adaptedMessage, adaptedSenderInfo);
      console.log('✅ Mensaje procesado exitosamente');

    } catch (error) {
      console.error('❌ Error procesando webhook:', error.stack);
      // Asegurarnos de que el error no interrumpa el servicio
      res.sendStatus(200);
      return;
    }

    res.sendStatus(200);
  }
  

  verifyWebhook(req, res) {
    try {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      console.log('🔍 Verificando webhook:', { mode, token: token ? '***' : undefined, challenge });

      if (!mode || !token) {
        console.log('❌ Parámetros de verificación incompletos');
        return res.sendStatus(400);
      }

      if (mode === 'subscribe' && token === config.WEBHOOK_VERIFY_TOKEN) {
        console.log('✅ Webhook verificado exitosamente');
        res.status(200).send(challenge);
      } else {
        console.log('❌ Verificación de webhook fallida - Token inválido o modo incorrecto');
        res.sendStatus(403);
      }
    } catch (error) {
      console.error('❌ Error verificando webhook:', error.stack);
      res.sendStatus(500);
    }
  }
}

export default new WebhookController();