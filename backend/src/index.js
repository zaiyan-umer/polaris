import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { notesRouter } from './routes/notes.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 4000

app.use(cors())
app.use(express.json())

app.get('/', (req, res) => {
  res.json({ service: 'polaris-backend', status: 'ok' })
})

app.use('/api/notes', notesRouter)

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`)
})
