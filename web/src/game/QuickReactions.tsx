import Icon, { type IconName } from '../ui/Icon'
import * as cmds from '../net/commands'
import { useStore } from '../state/store'
import { useTranslation } from '../i18n'
import './QuickReactions.css'

// Fila fija de reacciones de un click (spec sección 61.3). Se envían como
// mensaje de chat normal — XMage no tiene un canal de "reacción" dedicado,
// así que reutilizamos sendChatMessage con el emoji como texto.
//
// El emoji es solo lo que viaja por el cable: el botón pinta su equivalente en
// SVG (currentColor, hereda el tema) porque un cliente sin fuente de emoji de
// color dibujaría el carácter como un cuadro vacío.
export default function QuickReactions() {
  const { t } = useTranslation()
  const gameChatId = useStore((s) => s.gameChatId)
  const roomChatId = useStore((s) => s.roomChatId)
  const chatId = gameChatId || roomChatId

  const reactions: Array<{ emoji: string; icon: IconName; label: string }> = [
    { emoji: '👍', icon: 'agree', label: t('game', 'reaction_agree') },
    { emoji: '👏', icon: 'clap', label: t('game', 'reaction_applause') },
    { emoji: '⏳', icon: 'hourglass', label: t('game', 'reaction_waiting') },
    { emoji: '❓', icon: 'question', label: t('game', 'reaction_question') },
    { emoji: '✔️', icon: 'check', label: t('common', 'yes') },
    { emoji: '❌', icon: 'x', label: t('common', 'no') },
    { emoji: '🎉', icon: 'celebrate', label: t('game', 'reaction_celebrate') },
  ]

  const react = async (emoji: string) => {
    if (!chatId) return
    await cmds.sendChatMessage(chatId, emoji)
  }

  return (
    <div className="quick-reactions" role="group" aria-label={t('game', 'send_reaction')}>
      {reactions.map(({ emoji, icon, label }) => (
        <button
          key={emoji}
          type="button"
          className="quick-reaction-btn"
          data-reaction={icon}
          disabled={!chatId}
          onClick={() => react(emoji)}
          aria-label={label}
          title={label}
        >
          <Icon name={icon} size={16} />
        </button>
      ))}
    </div>
  )
}
