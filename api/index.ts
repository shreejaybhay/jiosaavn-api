import { handle } from '@hono/node-server/vercel'
import app from '../src/server'

export default handle(app)
