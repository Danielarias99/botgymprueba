/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import express from "express";
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import webhookController from './src/controllers/webhookController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Verificar la variable de entorno al inicio
console.log('VERIFICANDO ENV:', { GOOGLE_CREDENTIALS_BASE64_DEFINED: !!process.env.GOOGLE_CREDENTIALS_BASE64 });

const app = express();
app.use(express.json());

const { PORT } = process.env;

// Rutas del webhook
app.post("/webhook", webhookController.handleIncoming);
app.get("/webhook", webhookController.verifyWebhook);

app.get("/", (req, res) => {
  res.send(`<pre>Nothing to see here.
Checkout README.md to start.</pre>`);
});

app.listen(PORT, () => {
  console.log(`Server is listening on port: ${PORT}`);
});
