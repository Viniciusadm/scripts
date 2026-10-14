# folder-manager

Arquiva e restaura pastas do diretório atual. As pastas arquivadas saem do projeto e vão para `~/.folder-archive/<hash-do-caminho>/`, com um `metadata.json` por projeto — nada é apagado.

Também cria clones descartáveis de uma pasta (`fm clone`), para quando a pasta original já está ocupada com outra alteração. O único comando que apaga algo é o `fm drop`, e ele só aceita clones.

## Instalação

```bash
npm install
npm link
```

O comando fica disponível como `fm`.

## Uso

```bash
fm                        # abre o modo interativo (checkbox)
fm archive <pasta...>     # arquiva uma ou mais pastas
fm archive --all          # arquiva todas as pastas ativas (exceto ignoradas)
fm unarchive <pasta...>   # restaura uma ou mais pastas
fm unarchive --all        # restaura tudo que está arquivado neste projeto
fm list                   # lista as pastas ativas e arquivadas
fm ignore <pasta...>      # esconde pastas da lista e do modo interativo
fm unignore <pasta...>    # volta a mostrar pastas ignoradas
fm busy <pasta...>        # marca pastas como ocupadas
fm freeing <pasta...>     # marca pastas como em desocupação
fm free <pasta...>        # marca pastas como livres
fm clone <pasta>          # cria uma cópia descartável (<pasta>.tmp)
fm drop <pasta.tmp>       # apaga um clone descartável de vez
fm drop <pasta.tmp> -y    # apaga sem pedir confirmação (ou --yes)
fm drop --all             # apaga todos os clones descartáveis do projeto
fm drop --all -y          # idem, sem pedir confirmação
fm --help                 # ajuda
fm --version              # versão
```

### Exemplos

```bash
fm archive build dist
fm list
fm unarchive build

fm clone crm        # cria crm.tmp
fm clone crm        # cria crm.tmp2
fm drop crm.tmp     # apaga o clone
```

## Comportamento

- Cada diretório é um "projeto" separado, identificado pelo caminho absoluto. Arquivar em `~/projeto-a` não interfere em `~/projeto-b`.
- `archive` e `unarchive` validam tudo antes de mover: se qualquer pasta da lista for inválida, nenhuma é movida.
- Erros (pasta inexistente, já arquivada, nome já ocupado no destino) saem com código `1`, o que permite usar os comandos em scripts.
- O modo interativo continua tolerante: itens problemáticos são pulados com aviso e os demais são processados.

## Pastas ignoradas

- `fm ignore <pasta>` esconde a pasta do `fm list` e do modo interativo. Vale só para o projeto atual e fica salvo em `~/.folder-archive/<hash-do-caminho>/ignored.json`.
- A pasta não é movida nem alterada. Pode ser ignorada tanto uma pasta ativa quanto uma arquivada.
- `fm archive --all` pula as pastas ignoradas. Arquivar uma pasta ignorada pelo nome (`fm archive node_modules`) continua funcionando.
- O `fm list` mostra no rodapé quais pastas estão ignoradas; `fm unignore <pasta>` desfaz.

## Estados de uso

- Cada pasta tem um estado: **livre** (padrão), **ocupado** ou **em desocupação**. Ele aparece no `fm list` (com a data em que foi definido) e no modo interativo.
- `fm busy <pasta...>`, `fm freeing <pasta...>` e `fm free <pasta...>` mudam o estado. Valem para pastas ativas e arquivadas; se qualquer nome for inválido, nada é alterado.
- O estado é só informativo: `archive`, `unarchive` e `drop` funcionam igual, seja qual for o estado.
- O estado acompanha o nome da pasta, então continua o mesmo ao arquivar e restaurar. `fm drop` limpa o estado do clone apagado.
- Fica salvo em `~/.folder-archive/<hash-do-caminho>/status.json`; `fm free` remove a entrada.

## Clones descartáveis

- `fm clone <pasta>` copia a pasta inteira com `cp -a`, sem exceção: `.git`, `node_modules`, `.env`, builds e permissões vêm junto. O clone já sai utilizável, na mesma branch da origem.
- O nome do clone é `<pasta>.tmp` e, se esse já estiver em uso, `<pasta>.tmp2`, `<pasta>.tmp3`… Nomes ocupados por clones arquivados também são pulados.
- Clones aparecem como pastas ativas no `fm list` e no modo interativo, então podem ser arquivados como qualquer outra pasta.
- Não é possível clonar um clone: `fm clone crm.tmp` é recusado.
- **`fm drop` é o único comando que apaga de verdade.** Ele só aceita nomes no padrão `<nome>.tmp` ou `<nome>.tmpN` — apontar para uma pasta de trabalho normal é recusado antes de qualquer I/O. Sem `-y`/`--yes`, pede confirmação mostrando o tamanho — e a pergunta exige um terminal interativo, então quem roda sem TTY (script, agente) precisa do `-y`.
- `fm drop` funciona tanto no clone ativo quanto no clone arquivado: no segundo caso apaga o conteúdo em `~/.folder-archive/` e remove a entrada do `metadata.json`.
- `fm drop --all` apaga de uma vez todos os clones do projeto, ativos e arquivados. Clones ignorados são pulados, igual ao `fm archive --all`. Sem `-y`/`--yes`, lista os clones com o tamanho e pede uma confirmação só.
- A cópia é byte a byte. Clonar uma pasta com container rodando ou bind mount de Docker ativo copia um estado possivelmente inconsistente — pare os serviços antes.
