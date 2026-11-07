# program-chooser

"Help me choose" for Train > New template. A full-screen questionnaire in the goal-setup look (same `gs-*` classes:
steps, dots, animated SVG art, option buttons) that scores the ready-made programs from `modules/nippard-programs`
against the answers and recommends the best three with reasons, cautions and a match %.

## Questions (up to 13, in order)
situation (training / new / break / injury / restart) → away (only for a comeback) → joints (multi) → level → goal →
days (2–6) → time → gear → split → push (how hard) → focus (multi) → style → schedule. Single answers auto-advance
after a short pause; multi answers use Next. The art on each step reacts to the answer (calendar fills, clock arc,
sore joints turn amber, gauge needle).

## API
```js
ProgramChooser.QUESTIONS                       // the steps
ProgramChooser.stepsFor(answers)               // steps that apply to these answers
ProgramChooser.recommend(answers, programs)    // programs = NippardPrograms.create(data).list()
  // -> [{ id, score, pct, reasons[], cautions[], program }] best first
ProgramChooser.open({ programs, added(id), onPick(id, answers), onPreview(id, answers), onClose(reason, answers), onBack, document, mount })
  // -> { el, close(), state() }   reason: 'pick' | 'preview' | 'close'
ProgramChooser.css                             // inject once; GoalSetup.css must be on the page too
```
`TAGS` holds what the scorer knows per program id (split, gear, push, level, goal, comeback, supersets, variety…).
A program without tags gets neutral defaults from its `level` text, so adding a program to programs.json never breaks
the chooser; add a TAGS line to score it well. The test checks every program has tags and no tag is stale.

## Wiring
Logger mount options `chooser: window.ProgramChooser` and `onBack`; the New template sheet shows a "Help me choose"
card at the top when `chooser` is set (`data-a="progHelp"`). Add uses the same code path as "Add to my templates".

## Test
`node --test modules/program-chooser/program-chooser.test.js`
