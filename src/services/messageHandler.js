import { response } from 'express';
import whatsappService from './whatsappService.js';
import { appendToSheet, getAppointments, appendPauseToSheet, consultarMembresia } from './googleSheestsService.js';
import { preguntarAGemini } from './geminiService.js'; // ✅ Import correcto de Gemini









class MessageHandler {
  constructor() {
    this.appointmentState={};
    this.userData = {};
    this.consultaCounter = {}; // Contador de consultas por usuario
    this.lastConsultDate = {}; // Fecha de la última consulta
    this.userQueryCounts = {}; // { "+573001234567": { fecha: "2025-04-12", count: 1 } }
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
        console.log(`Mensaje ignorado de ${from} (no hay flujo activo ni es saludo): ${rawMessage}`);
        return;
      }
  
      if (isGreeting) {
        delete this.finalizedUsers?.[from]; // 👈 vuelve a permitir mensajes
        await this.sendWelcomeMessage(from, message.id, senderInfo);
        await this.sendWelcomeMenu(from);
      } else if (hasActiveFlow) {
        await this.handleAppointmentFlow(from, rawMessage, message.id);
      }
  
      await whatsappService.markAsRead(message.id);
    }
  
    // ✅ Botones interactivos
    else if (message?.type === "interactive") {
      const option = message?.interactive?.button_reply?.id.toLowerCase().trim();

      if (option === 'otra_consulta') {
        if (this.consultaCounter[from] < 3) {
          this.appointmentState[from] = { step: "esperando_pregunta_ia" };
          await whatsappService.sendMessage(from, "🧠 Estoy listo para responder tu consulta. ¡Escribe tu pregunta!");
        } else {
          await whatsappService.sendMessage(from, "Has alcanzado el límite de 3 consultas por día. ¡Vuelve mañana! 😊");
          this.finalizedUsers = this.finalizedUsers || {};
          this.finalizedUsers[from] = true;
          delete this.appointmentState?.[from];
        }
        return;
      }

      if (option === 'finalizar_chat' || option === 'consulta_finalizar') {
        this.finalizedUsers = this.finalizedUsers || {};
        this.finalizedUsers[from] = true;
        delete this.appointmentState?.[from];
        await whatsappService.sendMessage(from, '✅ Consulta finalizada. Si necesitas algo más, escribe *Hola* para comenzar de nuevo. ¡Que tengas un excelente día! 💪');
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

      await whatsappService.markAsRead(message.id);
    }
  }


  isGreeting(message) {
    const greetings = ["hola", "hello", "hi", "hol", "ola", "buenas tardes", "buenos días", "buenas noches","hola, buenas noches","hola, buenos dias","hola, buenas tardes","buenas",
    "hola, ¿cómo estás?", "hola, ¿me pueden ayudar?"];
    const normalizedMsg = message.toLowerCase()
    .replace(/[¿?!¡.,-]/g, ""); // Elimina signos de puntuación
    return greetings.some(greeting => normalizedMsg.includes(greeting));
  }


  getSenderName(senderInfo) {
    return senderInfo.profile?.name || senderInfo.wa_id;
  }

  async sendWelcomeMessage(to, messageId, senderInfo) {
    const name = this.getSenderName(senderInfo);
    const now = new Date().getHours();

    let timeGreeting = "¡Hola!"; // Valor por defecto
    if (now < 12) timeGreeting = "¡Buenos días!";
    else if (now < 19) timeGreeting = "¡Buenas tardes!";
    else timeGreeting = "¡Buenas noches!";

    const welcomeMessage = 
      `${timeGreeting} ${name} 👋\n` + 
      `¡Bienvenido a *GymBro*! 💪🏋️‍♂️\n` +
      `Somos tu aliado para alcanzar tus objetivos fitness 🔥\n` +
      `¿En qué puedo ayudarte hoy? 📌`;

    await whatsappService.sendMessage(to, welcomeMessage, messageId);
  }

  async sendWelcomeMenu(to) {
    const menuMessage = "Elige una opción:";
    const buttons = [
      { type: "reply", reply: { id: "opcion_1", title: "Agendar clases" } },
      { type: "reply", reply: { id: "opcion_2", title: "Consultar servicios" } },
      { type: "reply", reply: { id: "opcion_3", title: "Consulta abierta IA🤖" } }
    ];
  
    await whatsappService.sendInteractiveButtons(to, menuMessage, buttons);
  }
  

  async handleMenuOption(to, option) {
    let response;
    switch (option) {
      case "opcion_1":
        this.appointmentState[to] = { step: "name" };
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

    // Manejo del botón "Nueva consulta" después de consultar membresía
    if (message === "nueva_consulta") {
      state.step = "esperando_cedula_consulta";
      await whatsappService.sendMessage(to, "🔍 Por favor, ingresa tu número de cédula para consultar el estado de tu membresía:");
      return;
    }

    // Manejo de la opción "Consultar mensualidad"
    if (message === "4" || message.toLowerCase() === "consultar mensualidad") {
      state.step = "esperando_cedula_consulta";
      await whatsappService.sendMessage(to, "🔍 Por favor, ingresa tu número de cédula para consultar el estado de tu membresía:");
      return;
    }

    if (state.step === "esperando_cedula_consulta") {
      const cedula = message.trim();
      if (!/^\d{6,10}$/.test(cedula)) {
        await whatsappService.sendMessage(to, "⚠️ Por favor ingresa un número de cédula válido (entre 6 y 10 dígitos).");
        return;
      }

      try {
        const resultado = await consultarMembresia(cedula);
        await whatsappService.sendMessage(to, resultado.mensaje);
        await this.sendInteractiveButtons(to, "¿Qué deseas hacer?", [
          { type: "reply", reply: { id: "nueva_consulta", title: "🔁 Nueva consulta" } },
          { type: "reply", reply: { id: "finalizar_chat", title: "❌ Finalizar" } }
        ]);
      } catch (error) {
        console.error("Error al consultar membresía:", error);
        await whatsappService.sendMessage(to, "❌ Ocurrió un error al consultar la membresía. Por favor, intenta más tarde.");
      }
      return;
    }

    if (state.step === "esperando_pregunta_ia") {
      try {
        await whatsappService.sendMessage(to, "🤖 Pensando... un momento por favor.");
        
        const respuestaIA = await preguntarAGemini(message);
        await whatsappService.sendMessage(to, respuestaIA);

        // 👉 Control de consultas a Gemini
        const today = new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"
        this.userQueryCounts[to] = this.userQueryCounts[to] || { fecha: today, count: 0 };

        // 🔁 Reiniciar si es un nuevo día
        if (this.userQueryCounts[to].fecha !== today) {
          this.userQueryCounts[to] = { fecha: today, count: 0 };
        }

        this.userQueryCounts[to].count += 1;

        const consultasHechas = this.userQueryCounts[to].count;

        if (consultasHechas >= 3) {
          await whatsappService.sendMessage(to, "⚠️ Has alcanzado el límite de *3 consultas* por hoy. Vuelve mañana para hacer nuevas preguntas.");
          await this.sendInteractiveButtons(to, "¿Qué deseas hacer ahora?", [
            { type: "reply", reply: { id: "finalizar_chat", title: "✅ Finalizar chat" } }
          ]);
          delete this.appointmentState[to]; // Opcional: cerrar flujo
        } else {
          await this.sendInteractiveButtons(to, "¿Deseas hacer otra consulta o finalizar?", [
            { type: "reply", reply: { id: "opcion_3", title: "🤖 Otra consulta IA" } },
            { type: "reply", reply: { id: "finalizar_chat", title: "✅ Finalizar chat" } }
          ]);
        }
      } catch (error) {
        console.error('Error en consulta IA:', error);
        await whatsappService.sendMessage(to, "❌ Ocurrió un error al procesar tu consulta. Por favor, intenta nuevamente.");
      }
      return;
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
                  to, // 👈 Número de teléfono de WhatsApp (formato +573001234567)
                  state.name,
                  state.age,
                  state.day,
                  state.reason,
                  state.hour,
                  new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" })
                ];
                
        
                await appendToSheet(row);
                await whatsappService.sendMessage(
                  to,
                  "✅ ¡Tu clase ha sido agendada y registrada! Nos pondremos en contacto contigo en un momento para confirmar la fecha y hora. ¡Nos vemos pronto! 💪",
                  messageId
                );
              }
            } catch (err) {
              console.error("Error al procesar la cita:", err);
              await whatsappService.sendMessage(
                to,
                "⚠️ Ocurrió un error al guardar los datos. Intenta nuevamente o contáctanos.",
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
  } else if (["5", "pausar", "pausar membresia"].includes(normalized)) {
    state.step = "pausar_nombre";
    await whatsappService.sendMessage(to, `📝 Para solicitar una pausa de tu membresía, primero necesito algunos datos.\n\nPor favor, escribe tu nombre y apellido:`);
    return;
  } else if (["6", "asesor", "hablar asesor"].includes(normalized)) {
    response = `📲 Un asesor se pondrá en contacto contigo pronto. ¡Gracias por escribirnos! 💬`;
  } else {
    response = `❓ Opción no válida. Por favor escribe el número o nombre de la consulta:\n\n1. Precios 💰\n2. Horarios 🕒\n3. Ubicación y contacto 📍\n4. Consultar mensualidad 🧾\n5. Pausar membresía ⏸️\n6. Contactar asesor 🤝`;
  }

  await whatsappService.sendMessage(to, response);
  if (!["pausar_nombre", "esperando_cedula_consulta"].includes(state.step)) {
    await this.sendInteractiveButtons(to, "¿Deseas realizar otra consulta o finalizar?", [
      { type: "reply", reply: { id: "consulta_otra", title: "🔁 Otra consulta" } },
      { type: "reply", reply: { id: "consulta_finalizar", title: "❌ Finalizar" } }
    ]);
  }
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

  // Agregar método para manejar el contador de consultas
  checkConsultaLimit(from) {
    const today = new Date().toDateString();
    
    // Reiniciar contador si es un nuevo día
    if (this.lastConsultDate[from] !== today) {
      this.consultaCounter[from] = 0;
      this.lastConsultDate[from] = today;
    }

    return this.consultaCounter[from] < 3;
  }
}

export default new MessageHandler();