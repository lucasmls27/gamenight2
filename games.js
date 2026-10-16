/*
 * JOGOS PRÉ-DEFINIDOS
 * -------------------
 * A lista é exibida em ordem alfabética no app.
 *
 * Campos:
 *   id     identificador único (sem espaços)
 *   name   nome exibido
 *   icon   emoji do jogo
 *   type   como o jogo funciona:
 *
 *     'vitoria' -> botão "VENCEU" em cada jogador/time; cada toque = 1 vitória na noite
 *     'pontos'  -> botão "ACERTOU" (+1 ponto); ao finalizar, o vencedor ganha 1 vitória
 *     'vidas'   -> todos começam com X vidas; marca quem tomou ponto e avança a rodada;
 *                  último com vidas vence (1 vitória). Use `lives` para o padrão.
 *     'timer'   -> contagem regressiva (mímica/desenho) + "ACERTOU"; ao finalizar,
 *                  o vencedor ganha 1 vitória. Use `seconds` para o tempo padrão.
 *
 *   rules  (opcional) lembrete curto mostrado ao iniciar
 */
window.PRESET_GAMES = [
  { id: 'decisoes', name: 'DECISÕES DE MERDA', icon: '💩', type: 'vitoria' },
  { id: 'fdp', name: 'FDP', icon: '🃏', type: 'vitoria' },
  { id: 'ferradinha', name: 'FERRADINHA', icon: '🧲', type: 'vidas', lives: 3 },
  { id: 'imagem-acao', name: 'IMAGEM & AÇÃO', icon: '🎭', type: 'timer', seconds: 60 },
  { id: 'tema', name: 'JOGO DO TEMA', icon: '💡', type: 'pontos' },
];
