# Open Notes

Aplicativo de notas **livre e de código aberto**, inspirado na experiência dos apps de notas para tablets com caneta (estilo One UI): título grande, cartões arredondados, escrita à mão, pastas coloridas e notas bloqueadas.

Funciona em **qualquer celular, tablet ou computador**: é um PWA (Progressive Web App). Abra no navegador e use "Adicionar à tela inicial" para instalar como aplicativo. Funciona offline e os dados ficam só no seu dispositivo.

> Projeto independente, sem afiliação com a Samsung. "Samsung Notes" é marca da Samsung Electronics.

## Funcionalidades

**Notas e organização**
- Lista em grade, lista ou lista simples, com prévia de texto e desenhos
- Título grande que recolhe ao rolar, botão flutuante de nova nota
- Pastas com cores (criar, renomear, mudar cor, excluir), chips de pastas
- Favoritos (com opção de mostrar no topo), ordenação por data de modificação/criação/título
- Pesquisa por título e conteúdo
- Toque longo para selecionar várias notas: favoritar, mover, bloquear e excluir
- Lixeira com restauração (exclusão automática após 30 dias)

**Editor**
- Texto formatado: negrito, itálico, sublinhado, tachado, tamanhos, cor e realce, títulos, alinhamento, recuo
- Listas com marcadores, numeradas e **listas de tarefas** (checklist)
- Inserir imagens, foto da câmera, **gravação de voz**, tabelas, linha divisória, data/hora e links
- Modelos de página: liso, pautado, quadriculado, pontilhado, Cornell, e cores de página
- Salvamento automático, desfazer/refazer, duplicar nota

**Escrita à mão / desenho**
- Caneta, lápis, caneta-tinteiro e pincel com **sensibilidade à pressão** (S Pen, Apple Pencil, Wacom…)
- Marca-texto translúcido
- Borracha de traço inteiro ou de área, tamanho ajustável
- **Seleção laço**: mover, redimensionar, duplicar, mudar cor e excluir traços
- Modo "desenhar só com a caneta" (o dedo rola a página), rejeição de palma, rolagem com dois dedos
- Traços vetoriais que se adaptam à largura da tela

**Privacidade e dados**
- Notas bloqueadas por PIN e **criptografadas com AES-256-GCM** (chave derivada com PBKDF2)
- Tema claro, escuro ou do sistema
- Exportar nota como texto, HTML, PNG ou PDF (imprimir); compartilhar
- Backup completo em JSON e restauração; importar arquivos .txt

## Como usar

### Online (GitHub Pages)
Ative o GitHub Pages no repositório (Settings → Pages → Branch `main`, pasta `/root`) e abra o link no celular/tablet.

### Localmente
É só HTML/CSS/JavaScript, sem etapa de build.

```powershell
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

Depois abra http://localhost:8080. Qualquer servidor estático também funciona (`npx serve`, `python -m http.server`).

### Gerar APK (Android)
O PWA pode ser empacotado como app Android com [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) (TWA) ou [Capacitor](https://capacitorjs.com/).

## Estrutura

```
index.html            estrutura das telas
css/styles.css        visual (temas claro/escuro, layout celular/tablet)
js/app.js             lista, pastas, seleção, lixeira, bloqueio, configurações, backup
js/editor.js          editor de texto, inserções, estilo de página, exportação
js/ink.js             motor de escrita à mão (pressão, borracha, laço)
js/ui.js              diálogos, menus, folhas, navegação com botão voltar
js/db.js              armazenamento (IndexedDB)
js/crypto.js          criptografia das notas bloqueadas
sw.js                 funcionamento offline
tools/                servidor local e gerador de ícones
```

## Roteiro
- Zoom com pinça na página
- Importar PDF e anotar por cima
- Converter escrita à mão em texto
- Sincronização opcional entre dispositivos
- Gravação de voz sincronizada com a escrita

## Licença
[MIT](LICENSE)
