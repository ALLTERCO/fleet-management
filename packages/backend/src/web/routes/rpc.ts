import * as express from 'express';
const router = express.Router();
import { DEFAULT_RPC } from '../../globals';

router.get('/', (req, res) => {
    res.json(DEFAULT_RPC);
});

export default router;