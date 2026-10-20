
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Send, Trash2, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './GroupChat.css'

type ChatMessage = {
  id: string
  sender_id: string
  message: string
  created_at: string
}

type Sender = {
  id: string
  full_name: string
}

type Props = {
  userId: string
  isAdmin: boolean
}

export default function GroupChat({ userId, isAdmin }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [senders, setSenders] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!supabase) return

    const client = supabase
    let active = true

    async function loadMessages() {
      const { data, error } = await client
        .from('group_messages')
        .select('id,sender_id,message,created_at')
        .order('created_at', { ascending: false })
        .limit(100)

      if (!active) return

      if (error) {
        setError(error.message)
      } else {
        setMessages((data ?? []).reverse())
      }

      setLoading(false)
    }

    async function loadSenders() {
      const { data } = await client
        .from('profiles')
        .select('id,full_name')

      if (!active || !data) return

      const names: Record<string, string> = {}

      for (const sender of data as Sender[]) {
        names[sender.id] = sender.full_name
      }

      setSenders(names)
    }

    void loadMessages()
    void loadSenders()

    const channel = client
      .channel('engine-room-group-chat')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_messages',
        },
        () => {
          void loadMessages()
          void loadSenders()
        }
      )
      .subscribe()

    return () => {
      active = false
      void client.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const text = draft.trim()

    if (!supabase || !text || sending || text.length > 2000) return

    setSending(true)
    setError('')

    const { error } = await supabase
      .from('group_messages')
      .insert({
        sender_id: userId,
        message: text,
      })

    if (error) {
      setError(error.message)
    } else {
      setDraft('')

      const { data } = await supabase
        .from('group_messages')
        .select('id,sender_id,message,created_at')
        .order('created_at', { ascending: false })
        .limit(100)

      if (data) setMessages(data.reverse())
    }

    setSending(false)
  }

  async function deleteMessage(messageId: string) {
    if (!supabase || !window.confirm('Delete this message?')) return

    const { error } = await supabase
      .from('group_messages')
      .delete()
      .eq('id', messageId)

    if (error) {
      setError(error.message)
    } else {
      setMessages(previous =>
        previous.filter(item => item.id !== messageId)
      )
    }
  }

  return (
    <section className="group-chat">
      <header className="chat-header">
        <Users size={22} />
        <div>
          <h2>The Engine Room</h2>
          <p>Prayer Team Group Chat</p>
        </div>
      </header>

      <div className="chat-messages">
        {loading && <p className="chat-info">Loading messages...</p>}

        {!loading && messages.length === 0 && (
          <p className="chat-info">
            Welcome to the group! Send the first message.
          </p>
        )}

        {messages.map(item => {
          const mine = item.sender_id === userId

          return (
            <div
              key={item.id}
              className={`chat-message ${mine ? 'mine' : 'theirs'}`}
            >
              <div className="chat-bubble">
                <strong>
                  {mine ? 'You' : senders[item.sender_id] ?? 'Member'}
                </strong>

                <p>{item.message}</p>

                <div className="chat-meta">
                  <time>
                    {new Date(item.created_at).toLocaleTimeString(
                      'en-GH',
                      { hour: '2-digit', minute: '2-digit' }
                    )}
                  </time>

                  {(mine || isAdmin) && (
                    <button
                      type="button"
                      title="Delete message"
                      aria-label="Delete message"
                      onClick={() => void deleteMessage(item.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>

      {error && <p className="chat-error" role="alert">{error}</p>}

      <form className="chat-compose" onSubmit={sendMessage}>
        <input
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder="Type a message..."
          aria-label="Message"
          maxLength={2000}
          disabled={sending}
        />

        <button
          type="submit"
          disabled={!draft.trim() || sending}
          aria-label="Send message"
        >
          <Send size={20} />
        </button>
      </form>
    </section>
  )
}
