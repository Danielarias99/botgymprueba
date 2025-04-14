import path from "path";
import { google } from "googleapis";
import config from '../config/env.js';

const sheets = google.sheets("v4");

// Función para obtener las credenciales desde la variable de entorno
function getCredentials() {
  try {
    const credentials = Buffer.from(config.GOOGLE_CREDENTIALS_BASE64, 'base64').toString();
    return JSON.parse(credentials);
  } catch (error) {
    console.error('Error al decodificar credenciales:', error);
    throw new Error('Error al procesar credenciales de Google');
  }
}

// 🔁 Función genérica para agregar a cualquier hoja
async function addRowToSheet(auth, spreadsheetId, values, sheetName) {
  const request = {
    spreadsheetId,
    range: sheetName, // 👈 dinámico
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    resource: {
      values: [values],
    },
    auth,
  };

  try {
    console.log('📊 Intentando agregar fila a la hoja:', sheetName);
    const response = await sheets.spreadsheets.values.append(request);
    console.log('✅ Fila agregada correctamente');
    return response;
  } catch (error) {
    console.error('❌ Error al agregar fila:', error.response?.data || error.message);
    throw error;
  }
}

// 👉 Para reservas (hoja principal)
const appendToSheet = async (data) => {
  try {
    console.log('📝 Iniciando proceso de guardado en Sheets...');
    console.log('📊 Datos a guardar:', data);

    const credentials = getCredentials();
    console.log('🔑 Credenciales decodificadas correctamente');

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    console.log('🔐 Autenticación configurada');
    const authClient = await auth.getClient();
    console.log('👤 Cliente autenticado correctamente');

    const spreadsheetId = "1sNHbR0y52mlRE3z5E8JTaOMktUro3fPm6ZZPxXIUVZY";
    console.log('📑 Intentando agregar datos a la hoja:', spreadsheetId);

    const result = await addRowToSheet(authClient, spreadsheetId, data, "Reservas GymBro");
    console.log('✅ Datos agregados exitosamente:', result.data);

    return "Datos correctamente agregados a la hoja de reservas.";
  } catch (error) {
    console.error('❌ Error al agregar datos a Sheets:', error);
    console.error('Detalles del error:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data
    });
    throw error;
  }
};

// 🆕 Para pausas de membresía (segunda hoja)
const appendPauseToSheet = async (data) => {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: path.join(process.cwd(), "src/credentials", "credentials.json"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const authClient = await auth.getClient();
    const spreadsheetId = "1sNHbR0y52mlRE3z5E8JTaOMktUro3fPm6ZZPxXIUVZY";
    await addRowToSheet(authClient, spreadsheetId, data, "pausas_mensualidad");
    return "Pausa registrada correctamente.";
  } catch (error) {
    console.error("Error al guardar pausa:", error);
  }
};

// 🔍 Consultar estado de membresía
async function consultarMembresia(cedula) {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: path.join(process.cwd(), "src/credentials", "credentials.json"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const authClient = await auth.getClient();
    const spreadsheetId = "1sNHbR0y52mlRE3z5E8JTaOMktUro3fPm6ZZPxXIUVZY";

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Base de Datos",
      auth: authClient,
    });

    const rows = response.data.values || [];
    
    // Buscar la última entrada para esta cédula
    const userRows = rows.filter(row => row[1] === cedula);
    if (userRows.length === 0) {
      return {
        encontrado: false,
        mensaje: "❌ No se encontró ninguna membresía asociada a esta cédula."
      };
    }

    // Tomar la última entrada (la más reciente)
    const lastRow = userRows[userRows.length - 1];
    // Ajustamos los índices según la estructura de la hoja:
    // [telefono, cedula, nombre, tiempo, fechaInicio, fechaFin, estado]
    const [telefono, cedulaUser, nombre, tiempoPago, fechaInicio, fechaFin, estado] = lastRow;

    // Calcular días restantes
    const hoy = new Date();
    const finMembresia = new Date(fechaFin);
    const diferenciaDias = Math.ceil((finMembresia - hoy) / (1000 * 60 * 60 * 24));

    // Determinar estado actual
    let estadoActual = estado.toLowerCase();
    if (diferenciaDias <= 0 && estadoActual === 'activo') {
      estadoActual = 'vencido';
    }

    // Preparar mensaje según el estado
    let mensaje = `👤 *Membresía de ${nombre}*\n\n`;
    
    if (estadoActual === 'activo') {
      mensaje += `✅ Estado: Activo\n`;
      mensaje += `📅 Fecha inicio: ${fechaInicio}\n`;
      mensaje += `📅 Fecha fin: ${fechaFin}\n`;
      mensaje += `⏳ Días restantes: ${diferenciaDias}\n`;
      mensaje += `💰 Plan: ${tiempoPago}`;
    } else if (estadoActual === 'vencido') {
      mensaje += `❌ Estado: Vencido\n`;
      mensaje += `📅 Última membresía finalizó: ${fechaFin}\n`;
      mensaje += `💭 ¡Renueva tu membresía para seguir entrenando!`;
    } else {
      mensaje += `⚠️ Estado: ${estado}\n`;
      mensaje += `📅 Última actualización: ${fechaFin}`;
    }

    return {
      encontrado: true,
      mensaje,
      datos: {
        nombre,
        estado: estadoActual,
        diasRestantes: diferenciaDias,
        fechaFin,
        tiempoPago
      }
    };

  } catch (error) {
    console.error("Error al consultar membresía:", error);
    return {
      encontrado: false,
      mensaje: "❌ Ocurrió un error al consultar la membresía. Por favor, intenta más tarde."
    };
  }
}

// (Opcional, aún no lo tocamos) Para leer datos
async function getAppointments() {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: path.join(process.cwd(), "src/credentials", "credentials.json"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const authClient = await auth.getClient();
    const spreadsheetId = "1sNHbR0y52mlRE3z5E8JTaOMktUro3fPm6ZZPxXIUVZY";

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Reservas GymBro",
      auth: authClient,
    });

    const rows = response.data.values || [];

    return rows.map((row) => ({
      name: row[0],
      age: row[1],
      day: row[2],
      reason: row[3],
      createdAt: row[4],
    }));
  } catch (error) {
    console.error("Error al leer citas desde Sheets:", error);
    return [];
  }
}

export { appendToSheet, appendPauseToSheet, getAppointments, consultarMembresia };
