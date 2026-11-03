import { Router } from 'express';
import { config } from '../config.js';
import { decodeVinFull } from '../vin.js';

const router = Router();

router.get('/:vin', async (req, res) => {
  res.json(await decodeVinFull(req.params.vin, { apiKey: config.autoDevApiKey }));
});

export default router;
