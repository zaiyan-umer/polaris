import { Router } from 'express'
import { supabase } from '../db.js'

export const notesRouter = Router()

// List all notes
notesRouter.get('/', async (req, res) => {
  const { data, error } = await supabase.from('notes').select('*')
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// Create a note
notesRouter.post('/', async (req, res) => {
  const { text } = req.body
  if (!text) return res.status(400).json({ error: 'text is required' })
  const { data, error } = await supabase.from('notes').insert([{ text }]).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})
