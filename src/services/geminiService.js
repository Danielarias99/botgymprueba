import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Información específica del gimnasio en ambos idiomas
const GYM_INFO = {
  es: `
INFORMACIÓN OFICIAL DE GYMBRO:

- PRECIOS Y MEMBRESÍAS:
  * Mensual: $60.000 COP
  * Quincenal: $35.000 COP
  * Día: $10.000 COP
  * Incluye: Acceso completo a zonas y orientación de entrenadores

- HORARIOS:
  * Lunes a Viernes: 5:00am - 9:00pm
  * Sábados: 6:00am - 12:00m
  * Domingos y festivos: Cerrado

- UBICACIÓN Y CONTACTO:
  * Dirección: Calle 123 #45-67, Zarzal
  * Teléfono: +57 3116561249
  * Email: @gymbro@gmail.com
  * Atención: Lun-Sáb en horario establecido
`,
  en: `
OFFICIAL GYMBRO INFORMATION:

- PRICES AND MEMBERSHIPS:
  * Monthly: $60,000 COP
  * Biweekly: $35,000 COP
  * Daily: $10,000 COP
  * Includes: Full access to all areas and trainer guidance

- SCHEDULE:
  * Monday to Friday: 5:00am - 9:00pm
  * Saturday: 6:00am - 12:00pm
  * Sundays and holidays: Closed

- LOCATION AND CONTACT:
  * Address: Calle 123 #45-67, Zarzal
  * Phone: +57 3116561249
  * Email: @gymbro@gmail.com
  * Service hours: Mon-Sat during business hours
`
};

// Función para detectar el idioma
function detectLanguage(text) {
  // Palabras comunes en inglés
  const englishWords = [
    'i', 'me', 'my', 'how', 'can', 'what', 'where', 'when', 'why', 'who',
    'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'should', 'could', 'might',
    'the', 'a', 'an', 'and', 'or', 'but',
    'in', 'on', 'at', 'to', 'for', 'with',
    'sleep', 'workout', 'gym', 'fitness', 'training',
    'exercise', 'muscle', 'weight', 'body', 'health'
  ];
  
  const normalizedText = text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');
  const words = normalizedText.split(/\s+/);
  
  // Contar palabras en inglés
  const englishWordCount = words.filter(word => englishWords.includes(word)).length;
  
  // Si más del 20% de las palabras son en inglés o si contiene palabras clave en inglés
  return englishWordCount / words.length > 0.2 || 
         normalizedText.includes('in english') || 
         /\b(i|me|my)\b/.test(normalizedText) ||  // Detecta pronombres personales en inglés
         words[0].match(/\b(how|what|where|when|why|who)\b/); // Detecta preguntas en inglés
}

export async function preguntarAGemini(userPrompt) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

    // Detectar idioma
    const isEnglish = detectLanguage(userPrompt);
    const language = isEnglish ? 'en' : 'es';

    // Contexto específico para el gimnasio en el idioma detectado
    const systemContext = isEnglish 
      ? `You are a certified fitness coach, sports physiotherapist, medical wellness advisor, 
      and nutritionist working for GymBro — a high-performance center for training, health, and recovery. 
      Your role is to provide clear, concise (maximum 2–3 paragraphs), and specific answers in English, 
      tailored to real people. Focus on safe training practices, injury prevention, physical performance, 
      recovery, functional nutrition, and overall health. Avoid generic responses. Use a friendly yet professional tone.
         
         IMPORTANT: When asked about schedules, prices, location or any gym information,
         YOU MUST use EXACTLY the information provided below. DO NOT invent or modify this data:

         ${GYM_INFO.en}

         If the question is about this specific information, respond ONLY with the exact data provided above.
         For other questions about fitness and training, provide practical and direct advice.
         Use emojis to make the response friendly.
         If the question is not related to fitness, gym, or health, kindly respond that you can only help with gym-related topics.`
      : `Eres un asistente experto en fitness y entrenamiento físico para el gimnasio GymBro. 
         Proporciona respuestas CONCISAS (máximo 2-3 párrafos) y ESPECÍFICAS en español.
         
         IMPORTANTE: Cuando te pregunten sobre horarios, precios, ubicación o cualquier información del gimnasio,
         DEBES usar EXACTAMENTE la información proporcionada a continuación. NO inventes ni modifiques estos datos:

         ${GYM_INFO.es}

         Si la pregunta es sobre esta información específica, responde ÚNICAMENTE con los datos exactos proporcionados arriba.
         Para otras preguntas sobre fitness y entrenamiento, proporciona consejos prácticos y directos.
         Usa emojis para hacer la respuesta más amigable.
         Si la pregunta no está relacionada con fitness, gimnasio o salud, responde amablemente que solo puedes ayudar con temas relacionados al gimnasio.`;

    const fullPrompt = `${systemContext}\n\nPregunta del usuario: ${userPrompt}`;

    const response = await axios.post(url, {
      contents: [{ parts: [{ text: fullPrompt }] }]
    });

    const texto = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return texto || (isEnglish 
      ? 'Sorry, I could not generate a response 😢.'
      : 'Lo siento, no pude generar una respuesta 😢.');
  } catch (error) {
    console.error('Error con la API de Gemini:', error.response?.data || error.message);
    return isEnglish
      ? 'There was an error consulting the AI 🤖. Please try again later.'
      : 'Hubo un error al consultar la IA 🤖. Intenta más tarde.';
  }
}
