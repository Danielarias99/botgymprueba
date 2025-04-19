import { response } from 'express';
import whatsappService from './whatsappService.js';
import { appendToSheet, getAppointments, appendPauseToSheet, consultarMembresia } from './googleSheestsService.js';
import { preguntarAGemini } from './geminiService.js'; // ✅ Import correcto de Gemini









class MessageHandler {
  constructor() {
    this.appointmentState={};
    this.userData = {};
  }

  isThanksOrClosure(message) {
    const closurePhrases = [
      "gracias", "muchas gracias", "mil gracias",
      "todo claro", "perfecto", "genial", "excelente",
      "ok", "listo", "entendido", "vale", "de acuerdo"
    ];
  
    const normalizedMsg = message.toLowerCase()
      .replace(/[¿?!¡.,-]/g, "");
  
    return closurePhrases.some(phrase => normalizedMsg.includes(phrase));
  }


  async handleIncomingMessage(message, senderInfo) {
    const from = message.from;
  
    const allowedTypes = ["text", "interactive", "button", "image", "audio", "video", "document"];
    if (!allowedTypes.includes(message.type)) {
      console.log(`👀 Mensaje ignorado: tipo "${message.type}" de ${from}`);
      return;
    }
  
    // Si ya finalizó el chat, ignorar todo salvo que diga "hola"
    const finalized = this.finalizedUsers?.[from];
    
    if (message.id) {
      console.log(`👁️ Intentando marcar mensaje ${message.id} como leído...`);
      // Envolver en try/catch para que no detenga el flujo si falla
      try {
          await whatsappService.markAsRead(message.id);
          console.log(`👁️ Mensaje ${message.id} marcado como leído.`);
      } catch (readError) {
          console.warn(`⚠️ No se pudo marcar mensaje ${message.id} como leído:`, readError.message);
      }
    }
  
    if (message?.type === 'text') {
      const rawMessage = message.text.body.trim();
      const incomingMessage = rawMessage.toLowerCase();
      const stripped = rawMessage.replace(/[\s\u200B-\u200D\uFEFF]/g, '');
  
      if (!stripped.length) {
        console.log(`🕳️ Mensaje ignorado (vacío o sin contenido visible) de ${from}`);
        return;
      }
  
      if (finalized && !incomingMessage.includes('hola')) {
        console.log(`👋 Usuario ${from} finalizó el chat. Ignorando: ${rawMessage}`);
        return;
      }
  
      const hasActiveFlow = this.appointmentState[from];
      const isGreeting = this.isGreeting(incomingMessage);
  
      // Solo procesar si:
      // 1. Es un saludo
      // 2. O tiene un flujo activo
      if (!hasActiveFlow && !isGreeting) {
        console.log(`[handleIncomingMessage] Mensaje ignorado de ${from} (no hay flujo activo ni es saludo): ${rawMessage}`);
        return;
      }
  
      if (isGreeting) {
        console.log(`[handleIncomingMessage] 👋 Saludo detectado para ${from}! Ejecutando bloque de bienvenida...`); // Log al entrar
        try {
          // Intentar limpiar estado de finalizado
          console.log(`[handleIncomingMessage] Intentando limpiar finalizedUsers para ${from}...`);
          delete this.finalizedUsers?.[from]; // 👈 vuelve a permitir mensajes
          console.log(`[handleIncomingMessage] finalizedUsers limpiado para ${from}.`);
          
          // Enviar bienvenida
          console.log(`[handleIncomingMessage] Enviando mensaje de bienvenida a ${from}...`);
          await this.sendWelcomeMessage(from, message.id, senderInfo);
          console.log(`[handleIncomingMessage] Mensaje de bienvenida enviado a ${from}.`);
          
          // Enviar menú
          console.log(`[handleIncomingMessage] Enviando menú de bienvenida a ${from}...`);
          await this.sendWelcomeMenu(from);
          console.log(`[handleIncomingMessage] ✅ Menú de bienvenida enviado a ${from}.`);
        } catch (welcomeError) {
          console.error(`[handleIncomingMessage] ❌ Error dentro del bloque de bienvenida para ${from}:`, welcomeError);
        }
      } else if (hasActiveFlow) {
        console.log(`[handleIncomingMessage] 🔄 Flujo activo detectado para ${from}. Llamando a handleAppointmentFlow...`);
        await this.handleAppointmentFlow(from, rawMessage, message.id);
      }
    }
  
    // ✅ Botones interactivos
    else if (message?.type === "interactive") {
      const option = message?.interactive?.button_reply?.id.toLowerCase().trim();

      // Manejo botones especiales
      if (option === 'finalizar_chat') {
        this.finalizedUsers = this.finalizedUsers || {};
        this.finalizedUsers[from] = true;
        delete this.appointmentState?.[from];
        await whatsappService.sendMessage(from, '✅ Chat finalizado. Si necesitas algo más, escribe *Hola*.');
        return;
      }

      if (option === 'volver_menu') {
        delete this.finalizedUsers?.[from];
        await this.sendWelcomeMessage(from, message.id, senderInfo);
        await this.sendWelcomeMenu(from);
        return;
      }

      if (option === 'opcion_3') {
        this.appointmentState[from] = { step: "esperando_pregunta_ia" };
        await whatsappService.sendMessage(from, "🧠 Estoy listo para responder tu consulta. ¡Escribe tu pregunta!");
        return;
      }

      // Si tiene un flujo activo, manejarlo
      if (this.appointmentState[from]) {
        await this.handleAppointmentFlow(from, option, message.id);
      } 
      // Si es una opción del menú principal, procesarla
      else if (['opcion_1', 'opcion_2'].includes(option)) {
        await this.handleMenuOption(from, option);
      }
      // Si no es ninguna de las anteriores, ignorar
      else {
        console.log(`Botón ignorado de ${from} (no es opción válida): ${option}`);
        return;
      }
    }
  }


  isGreeting(message) {
    console.log(`[isGreeting] Checking message: '${message}'`); // Log inicial
    const greetings = [
      "hola", "hello", "hi", "hol", "ola", 
      "buenas tardes", "buenos días", "buenas noches",
      "buenas", "buen dia", "que tal", "saludos",
      "hola buenos", "hola buenas", "hey", "holis",
      "hola que tal", "como estas", "como va",
      "hola necesito ayuda", "hola quisiera consultar",
      // Añadir posibles variaciones si es necesario
      "hola,", "hola."
    ];
    
    const normalizedMsg = message.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Elimina acentos
      .replace(/[¿?!¡.,-]/g, "") // Elimina signos de puntuación
      .trim();
    console.log(`[isGreeting] Normalized message: '${normalizedMsg}'`); // Log normalizado

    const result = greetings.some(greeting => 
      normalizedMsg.includes(greeting) || 
      normalizedMsg.startsWith(greeting)
    );
    console.log(`[isGreeting] Result: ${result}`); // Log resultado
    return result;
  }


  getSenderName(senderInfo) {
    return senderInfo.profile?.name || senderInfo.wa_id;
  }

  async sendWelcomeMessage(to, messageId, senderInfo) {
    const name = this.getSenderName(senderInfo);
    const now = new Date().getHours();


// 1. Modifica esta parte para el saludo horario (usa tus variables existentes)
let timeGreeting = "¡Hola"; // Valor por defecto
if (now < 12) timeGreeting = "¡Buenos días!";
else if (now < 19) timeGreeting = "¡Buenas tardes!";
else timeGreeting = "¡Buenas noches!";



    const welcomeMessage =`Hola,${timeGreeting} ${name} 👋\n` + 
    `¡Bienvenido a *GymBro*!💪🏋️‍♂️🔥\n` +
    `Somos tu aliado para alcanzar tus objetivos fitness. 💯\n` +
    `¿En qué puedo ayudarte hoy?📌\n`;
   





    await whatsappService.sendMessage(to, welcomeMessage, messageId);
  }

  async sendWelcomeMenu(to) {
    const menuMessage = "Elige una opción";
    const buttons = [
      { type: "reply", reply: { id: "opcion_1", title: "Agendar clases" } },
      { type: "reply", reply: { id: "opcion_2", title: "Consultar servicios" } },
      { type: "reply", reply: { id: "opcion_3", title: "Consulta abierta IA🤖 " } },
    ];
  
    await whatsappService.sendInteractiveButtons(to, menuMessage, buttons);
  }
  

  async handleMenuOption(to, option) {
    let response;
    switch (option) {
      case "opcion_1":
        this.appointmentState[to]= {step:"name"}
        response = "Por favor, Ingresa tu nombre y apellido";
        break;
        case "opcion_2":
          this.appointmentState[to] = { step: "consultas_lista" };
          response = `📋 *Opciones de consulta:*\n\n1. Precios 💰\n2. Horarios 🕒\n3. Ubicación y contacto 📍\n4. Consultar mensualidad 🧾\n5. Pausar membresía ⏸️\n6. Contactar asesor 🤝`;
          break;
        
          case "opcion_3":
            this.appointmentState[to] = { step: "esperando_pregunta_ia" };
            response = "🧠 Estoy listo para responder tu consulta. ¡Escribe tu pregunta!";
            break;
          
    }
    await whatsappService.sendMessage(to, response);
  }

  async sendMedia(to, type) {
    let mediaUrl = "";
    let caption = "";
  
    switch (type) {
      case "audio":
        mediaUrl = "https://chatbotgymbro.s3.us-east-2.amazonaws.com/gymbroaudi.ogg";
        caption = "audio de bienvenida🏋️‍♂️";
        break;
      case "video":
        mediaUrl = "https://tu-bucket-s3/video.mp4";
        caption = "Video motivacional 💥";
        break;
      case "image":
        mediaUrl = "https://chatbotgymbro.s3.us-east-2.amazonaws.com/ChatGPT+Image+3+abr+2025%2C+08_26_07+p.m..png";
        caption = "Mira nuestro gym 🏋️‍♂️";
        break;
      case "document":
        mediaUrl = "https://chatbotgymbro.s3.us-east-2.amazonaws.com/planes_precios_gymbro.pdf";
        caption = "Planes y precios 📝";
        break;
      default:
        console.error("Tipo de medio no soportado");
        return;
    }
  
    await whatsappService.sendMediaMessage(to, type, mediaUrl, caption);
  }
  

  async handleAppointmentFlow(to, message, messageId) {
    const state = this.appointmentState[to];
    let response;

    console.log(`🔄 Handling state: ${state?.step} for user ${to} with message: ${message}`); // Log inicial

    // 👇 Manejo de los botones "Otra consulta" y "Finalizar"
    if (message === "consulta_otra") {
      state.step = "consultas_lista";
      const response = `📋 Estas son las opciones disponibles:\n\n1. Precios 💰\n2. Horarios  🧾\n3. Ubicación y contacto 📍🕒\n4.Consultar mi estado de mensualidad \n5.Pausar membresía ⏸️ \n6. Hablar con un asesor 🤝`;
      await whatsappService.sendMessage(to, response);
      return;
    }

    if (message === "consulta_finalizar") {
      delete this.appointmentState[to];
      const response = `✅ Consulta finalizada. ¡Gracias por comunicarte con *GymBro*! Si deseas volver a consultar, escribe *Hola* 💬.`;
      await whatsappService.sendMessage(to, response);
      return;
    }

    // 💬 Manejo de la consulta abierta con Gemini
    if (state.step === "esperando_pregunta_ia") {
      await whatsappService.sendMessage(to, "🤖 Pensando... un momento por favor.");
      const respuestaIA = await preguntarAGemini(message);
      
      // Dividir respuesta si es muy larga
      const MAX_LENGTH = 4000;
      if (respuestaIA.length > MAX_LENGTH) {
        const chunks = respuestaIA.match(new RegExp(`.{1,${MAX_LENGTH}}`, 'g')) || [];
        for (const chunk of chunks) {
          await whatsappService.sendMessage(to, chunk);
        }
      } else {
        await whatsappService.sendMessage(to, respuestaIA);
      }

      // Mantener el estado para seguir en modo IA
      state.step = "esperando_pregunta_ia";
      
      // Solo mostrar botón de finalizar con mensaje más preciso
      await this.sendInteractiveButtons(to, "Si has terminado, puedes finalizar la consulta:", [
        { type: "reply", reply: { id: "finalizar_chat", title: "❌ Finalizar consulta" } }
      ]);
      return;
    }

    // 🧾 Manejo específico para esperar la cédula
    if (state.step === "esperando_cedula") {
      const cedula = message.trim();
      console.log(`🆔 Cédula recibida: ${cedula} para usuario ${to}`);
      if (!/^\d{6,10}$/.test(cedula)) {
        await whatsappService.sendMessage(to, "⚠️ Por favor ingresa un número de cédula válido (entre 6 y 10 dígitos).");
        return; // Mantenemos el estado esperando_cedula
      }

      try {
        console.log(`🔍 Llamando a consultarMembresia con cédula: ${cedula}`);
        await whatsappService.sendMessage(to, "Consultando tu membresía... ⏳"); // Mensaje de espera
        const resultadoConsulta = await consultarMembresia(cedula);
        console.log(`📊 Resultado de consultarMembresia:`, resultadoConsulta);

        if (resultadoConsulta && resultadoConsulta.mensaje) {
          console.log(`💬 Enviando respuesta de membresía a ${to}`);
          await whatsappService.sendMessage(to, resultadoConsulta.mensaje);
        } else {
          console.error(`❌ Error: consultarMembresia no devolvió un mensaje válido para ${cedula}`);
          await whatsappService.sendMessage(to, "❌ Hubo un problema al consultar tu membresía. Intenta más tarde.");
        }

        // Después de consultar, volvemos a ofrecer opciones
        delete state.step; // Limpiar el estado de esperar cédula
        await this.sendInteractiveButtons(to, "¿Deseas realizar otra consulta o finalizar?", [
            { type: "reply", reply: { id: "consulta_otra", title: "🔁 Otra consulta" } },
            { type: "reply", reply: { id: "consulta_finalizar", title: "❌ Finalizar" } },
        ]);

      } catch (error) {
        console.error(`❌ Error al llamar o procesar consultarMembresia para ${cedula}:`, error);
        await whatsappService.sendMessage(to, "❌ Ocurrió un error grave al consultar tu membresía. Por favor, contacta a un asesor.");
        delete state.step; // Limpiar estado incluso si hay error
      }
      return; // Importante: Terminar aquí después de manejar la cédula
    }

  
    switch (state.step) {
      case 'name':
        if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/.test(message)) {
          response = 'Por favor ingresa solo tu nombre y apellido, sin números ni caracteres especiales.';
          break;
        }
  
        state.name = message.trim();
        state.step = 'age';
        this.userData[to] = { name: message.trim() };
        response = '¿Cuál es tu edad?';
        break;
  
        case 'age':
  if (!/^\d+$/.test(message)) {
    response = 'Por favor ingresa solo tu edad en números. Ej: 25';
    break;
  }

  const age = parseInt(message, 10);
  if (age < 9 || age > 60) {
    response = '🧍‍♂️ La edad debe estar entre *9 y 60 años*. Si tienes dudas, contáctanos directamente 💬.';
    break;
  }

  state.age = age;
  state.step = 'awaitingDayInput';
  response = `📅 ¿Para qué día quieres agendar tu clase?\n\n1. Lunes\n2. Martes\n3. Miércoles\n4. Jueves\n5. Viernes\n6. Sábado`;
  break;

case 'awaitingDayInput':
  const daySelection = message.trim().toLowerCase();
  const dayMap = {
    "1": "Lunes",
    "2": "Martes",
    "3": "Miércoles",
    "4": "Jueves",
    "5": "Viernes",
    "6": "Sábado",
    "lunes": "Lunes",
    "martes": "Martes",
    "miércoles": "Miércoles",
    "miercoles": "Miércoles",
    "jueves": "Jueves",
    "viernes": "Viernes",
    "sábado": "Sábado",
    "sabado": "Sábado"
  };

  if (!dayMap[daySelection]) {
    response = "❗ Por favor responde con el *número* o *nombre del día* (Ej: 1, lunes, sábado).";
    break;
  }

  state.day = dayMap[daySelection];
  state.step = "hour";
  response = "⏰ ¿A qué hora quieres agendar tu clase? (formato 24h, ej: *14:30*)";
  break;

  
      case 'hour':
        const hourRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!hourRegex.test(message)) {
          response = "⏰ Por favor ingresa una hora válida en formato 24 horas. Ejemplo: *14:30*";
          await whatsappService.sendMessage(to, response);
          return;
        }
  
        const [hour, minute] = message.split(":").map(Number);
        const totalMinutes = hour * 60 + minute;
        const minMinutes = 5 * 60;
        const maxMinutes = 21 * 60;
  
        if (totalMinutes < minMinutes || totalMinutes > maxMinutes) {
          response = "🕔 El horario disponible para clases es de *05:00 a 21:00*. Por favor ingresa una hora dentro de ese rango.";
          await whatsappService.sendMessage(to, response);
          return;
        }
  
        state.hour = message;
        state.step = "reason";
        response = "¿Qué tipo de clase deseas?\n\n1. Yoga 🧘‍♂️\n2. Crossfit 🏋️‍♂️\n3. Funcional 🔥\n4. Entrenamiento personalizado 💪";
        break;
  
      case "reason":
        const input = message.trim().toLowerCase();
        let selectedClass = null;
  
        if (["1", "yoga", "yog"].some(v => input.includes(v))) {
          selectedClass = "Yoga";
        } else if (["2", "crossfit", "cross"].some(v => input.includes(v))) {
          selectedClass = "Crossfit";
        } else if (["3", "funcional", "funcion"].some(v => input.includes(v))) {
          selectedClass = "Funcional";
        } else if (["4", "entrenador", "personal"].some(v => input.includes(v))) {
          selectedClass = "Entrenador Personalizado";
        }
  
        if (selectedClass === "Entrenador Personalizado") {
          state.step = "trainerSelection";
          response = "¿Con qué entrenador quieres agendar?\n\n1. Mateo 🔥\n2. Laura 🧘‍♀️\n3. Andrés 🦾";
        } else if (selectedClass) {
          state.reason = selectedClass;
          state.step = "confirmation";
          response = `📝 *Resumen de tu clase agendada:*\n\n👤 Nombre: ${state.name}\n🎂 Edad: ${state.age}\n📅 Día: ${state.day}\n🕒 Hora: ${state.hour}\n🏋️ Clase: ${state.reason}\n\n¿Deseas confirmar tu cita?`;
          await whatsappService.sendMessage(to, response);
          await this.sendInteractiveButtons(to, "Confirma tu cita:", [
            { type: "reply", reply: { id: "confirmar", title: "✅ Confirmar" } },
            { type: "reply", reply: { id: "cancelar", title: "❌ Cancelar" } }
          ]);
          return;
        } else {
          response = "Por favor selecciona una opción válida (1-4 o escribe el nombre de la clase).";
        }
        break;
  
      case "trainerSelection":
        const trainerInput = message.trim().toLowerCase();
        let selectedTrainer = null;
  
        if (["1", "mateo", "mat"].some(v => trainerInput.includes(v))) {
          selectedTrainer = "Mateo";
        } else if (["2", "laura", "lau"].some(v => trainerInput.includes(v))) {
          selectedTrainer = "Laura";
        } else if (["3", "andres", "andrés", "andr"].some(v => trainerInput.includes(v))) {
          selectedTrainer = "Andrés";
        }
  
        if (selectedTrainer) {
          state.reason = `Entrenador Personal con ${selectedTrainer}`;
          state.step = "confirmation";
          response = `📝 *Resumen de tu clase agendada:*\n\n👤 Nombre: ${state.name}\n🎂 Edad: ${state.age}\n📅 Día: ${state.day}\n🕒 Hora: ${state.hour}\n🏋️ Clase: ${state.reason}\n\n¿Deseas confirmar tu cita?`;
          await whatsappService.sendMessage(to, response);
          await this.sendInteractiveButtons(to, "Confirma tu cita:", [
            { type: "reply", reply: { id: "confirmar", title: "✅ Confirmar" } },
            { type: "reply", reply: { id: "cancelar", title: "❌ Cancelar" } }
          ]);
          return;
        } else {
          response = "Por favor selecciona un entrenador válido (1, 2, 3 o su nombre). Ej: Mateo, Laura o Andrés.";
        }
        break;
  
        case "confirmation":
          if (message === "confirmar") {
            try {
              const existingAppointments = await getAppointments();
              const alreadyRegistered = existingAppointments.some(
                (appointment) =>
                  appointment.name === state.name &&
                  appointment.day === state.day &&
                  appointment.reason === state.reason
              );
        
              if (alreadyRegistered) {
                await whatsappService.sendMessage(
                  to,
                  "📌 Ya tienes una clase agendada con esos datos. Si necesitas cambiarla, responde con *cancelar* y vuelve a intentarlo.",
                  messageId
                );
              } else {
                const row = [
                  to,
                  state.name,
                  state.age,
                  state.day,
                  state.reason,
                  state.hour,
                  new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" })
                ];
                
                console.log('Intentando guardar en sheets:', row);
                const result = await appendToSheet(row);
                console.log('Resultado de sheets:', result);
                
                await whatsappService.sendMessage(
                  to,
                  "✅ ¡Tu clase ha sido agendada y registrada! Nos pondremos en contacto contigo en un momento para confirmar la fecha y hora. ¡Nos vemos pronto! 💪",
                  messageId
                );
              }
            } catch (err) {
              console.error("❌ Error al procesar la cita en messageHandler:", err);
              // Loguear detalles específicos del error de Sheets si existen
              if (err.response?.data?.error) {
                console.error("Detalles del error de Google Sheets API:", err.response.data.error);
              }
              await whatsappService.sendMessage(
                to,
                "⚠️ Ocurrió un error al guardar los datos. Por favor, inténtalo de nuevo más tarde o contacta a un asesor.",
                messageId
              );
            }
        
            delete this.appointmentState[to];
        
            // 🔘 Botones finales
            await this.sendInteractiveButtons(to, "¿Qué deseas hacer ahora?", [
              { type: "reply", reply: { id: "finalizar_chat", title: "✅ Finalizar chat" } },
              { type: "reply", reply: { id: "volver_menu", title: "🏠 Volver al menú" } }
            ]);
        
          } else if (message === "cancelar") {
            await whatsappService.sendMessage(
              to,
              "❌ Tu cita ha sido cancelada.",
              messageId
            );
        
            delete this.appointmentState[to];
        
            // 🔘 Botones finales también después de cancelar
            await this.sendInteractiveButtons(to, "¿Qué deseas hacer ahora?", [
              { type: "reply", reply: { id: "finalizar_chat", title: "✅ Finalizar chat" } },
              { type: "reply", reply: { id: "volver_menu", title: "🏠 Volver al menú" } }
            ]);
        
          } else {
            await whatsappService.sendMessage(
              to,
              "Por favor elige una opción válida para confirmar o cancelar.",
              messageId
            );
          }
          return;


          case "consultas_lista":
            const option = message.trim().toLowerCase();
            const normalized = option.replace(/[^a-z0-9áéíóúñü]/gi, '').toLowerCase();

            if (["1", "precios", "membresia", "membresías"].includes(normalized)) {
              response = `💰 *Precios y membresías:*\n\n- Mensual: $60.000 COP\n- Quincenal: $35.000 COP\n- Día: $10.000 COP\n\nIncluye acceso completo a todas las zonas del gimnasio, y orientación de los entrenadores.`;
            } else if (["2", "horarios", "horario"].includes(normalized)) {
              response = `🕒 *Horarios del Gym:*\n\nLunes a Viernes: 5:00am - 9:00pm\nSábados: 6:00am - 12:00m\nDomingos y festivos: Cerrado.`;
            } else if (["3", "ubicacion", "ubicación", "contacto", "direccion", "dirección"].includes(normalized)) {
              response = `📍 *Ubicación y contacto:*\n\n📌 Dirección: Calle 123 #45-67, Zarzal\n📞 Tel: +57 3116561249\n📧 Email: @gymbro@gmail.com\n🕘 Atención: Lun-Sáb en el horario establecido`;
            } else if (["4", "estado", "miestado", "estado membresia", "consultar mensualidad"].includes(normalized)) { // Añadido "consultar mensualidad"
              response = `🧾 Para consultar tu estado de membresía, por favor responde con tu número de cédula.`;
              state.step = "esperando_cedula";
              console.log(`⏳ Cambiando estado a 'esperando_cedula' para ${to}`);
              return await whatsappService.sendMessage(to, response);
            } else if (["5", "pausar", "pausar membresia", "pausarmembresia"].includes(normalized)) {
              response = `📝 Para solicitar una pausa de tu membresía, primero necesito algunos datos.\n\nPor favor, escribe tu nombre y apellido:`;
              state.step = "pausar_nombre";
              console.log(`⏳ Cambiando estado a 'pausar_nombre' para ${to}`);
              return await whatsappService.sendMessage(to, response);
            } else if (["6", "asesor", "hablar asesor", "ayuda", "asesoria"].includes(normalized)) {
              const advisorName = "Daniel Feria";
              const advisorPhone = "+573116561249";
              response = 
                `Puedes contactar directamente a nuestro asesor *${advisorName}* 🧑‍💼:\n\n` +
                `📞 Teléfono: ${advisorPhone}\n\n` +
                `Puedes agregarlo a tus contactos o iniciar un chat directamente con él.`;
              console.log(`📲 Enviando información de contacto del asesor a ${to}`);
            } else {
              response = `❓ Opción no válida. Por favor escribe el número o nombre de la consulta:\n\n1. Precios 💰\n2. Horarios 🕒\n3. Ubicación y contacto 📍\n4. Consultar mensualidad 🧾\n5. Pausar membresía ⏸️\n6. Contactar asesor 🤝`;
            }

            // 👉 Solo se llega aquí si no cambia a otro paso (como pausar o consultar cédula)
            await whatsappService.sendMessage(to, response);
            console.log(`📤 Enviada respuesta para opción: ${option} a ${to}`);
            await this.sendInteractiveButtons(to, "¿Deseas realizar otra consulta o finalizar?", [
              { type: "reply", reply: { id: "consulta_otra", title: "🔁 Otra consulta" } },
              { type: "reply", reply: { id: "consulta_finalizar", title: "❌ Finalizar" } },
            ]);
            return;

case "pausar_nombre":
    const nombreCompleto = message.trim();
    if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/.test(nombreCompleto)) {
      response = "⚠️ Por favor ingresa un nombre válido (solo letras y espacios).";
      break;
    }
    
    state.nombre = nombreCompleto;
    state.step = "pausar_cedula";
    response = "⏸️ Ahora, por favor ingresa tu número de cédula:";
    await whatsappService.sendMessage(to, response);
    return;

case "pausar_cedula":
    const cedulaPausa = message.trim();
    if (!/^\d{6,10}$/.test(cedulaPausa)) {
      response = "⚠️ Por favor ingresa un número de cédula válido para pausar tu membresía. Ej: 1032456789";
      break;
    }
  
    state.cedula = cedulaPausa;
    state.step = "pausar_motivo";
  
    await whatsappService.sendMessage(to, "📝 Por favor cuéntanos brevemente el motivo por el cual deseas pausar tu membresía:");
    return;

case "pausar_motivo":
    const motivo = message.trim();
    const timestamp = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" });
    // Ordenamos los datos según las columnas: [telefono, cedula, nombre, motivo, fecha, estado]
    const pausaData = [
      to,                // Número de teléfono
      state.cedula,      // Cédula
      state.nombre,      // Nombre completo
      motivo,           // Motivo/razón
      timestamp,        // Fecha y hora
      ""                // Estado (vacío para manejo manual)
    ];

    try {
      await appendPauseToSheet(pausaData);
      response = `⏸️ Tu solicitud de pausa ha sido registrada con éxito.\n\n*Datos registrados:*\n👤 Nombre: ${state.nombre}\n📋 Cédula: ${state.cedula}\n\nUn asesor revisará tu caso y te contactará pronto. ¡Gracias por informarnos!`;
    } catch (err) {
      console.error("Error al registrar pausa:", err);
      response = "❌ Ocurrió un error al guardar tu solicitud. Intenta más tarde.";
    }

    delete this.appointmentState[to];
    await whatsappService.sendMessage(to, response);
    await this.sendInteractiveButtons(to, "¿Qué deseas hacer ahora?", [
      { type: "reply", reply: { id: "volver_menu", title: "🏠 Volver al menú" } },
      { type: "reply", reply: { id: "finalizar_chat", title: "✅ Finalizar chat" } }
    ]);
    return;

            

  // ✅ SOLO si NO cambia a otro step, se envían los botones
  await whatsappService.sendMessage(to, response);
  await this.sendInteractiveButtons(to, "¿Deseas realizar otra consulta o finalizar?", [
    { type: "reply", reply: { id: "consulta_otra", title: "🔁 Otra consulta" } },
    { type: "reply", reply: { id: "consulta_finalizar", title: "❌ Finalizar" } }
  ]);
  return;

    }

    
  
    // ✅ Validación segura antes de enviar el mensaje
    if (typeof response === "string" && response.trim() !== "") {
      await whatsappService.sendMessage(to, response);
    }
  }

  async sendInteractiveButtons(to, text, buttons) {
    await whatsappService.sendInteractiveButtons(to, text, buttons);
  }
}

export default new MessageHandler();