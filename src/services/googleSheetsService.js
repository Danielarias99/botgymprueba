import path from "path";
import { google } from "googleapis";
import fs from 'fs';

const sheets = google.sheets("v4");

// Función para obtener las credenciales
function getGoogleCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_BASE64) {
    // Para producción (Railway)
    const credentials = JSON.parse(
      Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString()
    );
    return credentials;
  } else {
    // Para desarrollo local
    const credentialsPath = path.join(process.cwd(), "src/credentials", "credentials.json");
    return JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  }
}

// 🔁 Función genérica para agregar a cualquier hoja
async function addRowToSheet(auth, spreadsheetId, values, sheetName) {
  const request = {
    spreadsheetId,
    range: sheetName,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    resource: {
      values: [values],
    },
    auth,
  };

  try {
    const response = await sheets.spreadsheets.values.append(request);
    return response;
  } catch (error) {
    console.error("Error al agregar fila:", error);
  }
}

// 👉 Para reservas (hoja principal)
const appendToSheet = async (data) => {
  try {
    const credentials = getGoogleCredentials();
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const authClient = await auth.getClient();
    const spreadsheetId = "1sNHbR0y52mlRE3z5E8JTaOMktUro3fPm6ZZPxXIUVZY";
    await addRowToSheet(authClient, spreadsheetId, data, "Reservas GymBro");
    return "Datos correctamente agregados a la hoja de reservas.";
  } catch (error) {
    console.error(error);
  }
};

// ... resto del código sin cambios ... 