import type { ReactNode } from 'react';

/**
 * The guide: from an example app to a device on your desk, for someone who has never done any of it.
 * Every control it names is wrapped in <Ui>, and tests/guide.test.ts checks each one still exists in
 * Bench's UI, so a renamed button can't leave the guide pointing at nothing.
 */

/** A button, menu or panel in Bench, named as it appears there. */
const Ui = ({ children }: { children: string }) => <span className="ui">{children}</span>;
const Key = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>;
const Out = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer">
    {children}
  </a>
);

const STEPS = [
  { id: 'example', title: 'Start from an example' },
  { id: 'resident', title: 'Let Claude write your app' },
  { id: 'board', title: 'Put it on a real board' },
  { id: 'parts', title: 'Change the outputs and inputs' },
  { id: 'wiring', title: 'Wire real parts' },
  { id: 'keep', title: 'Keep it and share it' },
];

function Step({ n, children }: { n: number; children: ReactNode }) {
  const step = STEPS[n - 1];
  return (
    <section className="guide-step" id={step.id} aria-labelledby={`${step.id}-title`}>
      <p className="guide-num">Step {n}</p>
      <h2 id={`${step.id}-title`}>{step.title}</h2>
      {children}
    </section>
  );
}

/** Something to check before going on: what you should see if the step worked. */
const Check = ({ children }: { children: ReactNode }) => (
  <p className="guide-check">
    <span className="guide-check-label">You should see</span> {children}
  </p>
);

export function Guide() {
  return (
    <div className="guide">
      <header className="toolbar">
        <a className="brand" href="/" title="Back to Bench">
          <span>porous.systems</span> Bench
        </a>
        <span className="toolbar-gap" />
        <a className="guide-open" href="/">
          Open Bench
        </a>
      </header>

      <div className="guide-layout">
        <nav className="guide-toc" aria-label="Steps">
          <p className="guide-kicker">On this page</p>
          <ol>
            <li>
              <a href="#pieces">The pieces</a>
            </li>
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>
                  <span className="guide-toc-n">{i + 1}</span> {s.title}
                </a>
              </li>
            ))}
            <li>
              <a href="#stuck">When something's wrong</a>
            </li>
          </ol>
        </nav>

        <main className="guide-body">
          <p className="guide-kicker">Guide</p>
          <h1>From an idea to a device on your desk</h1>
          <p className="guide-lede">
            This walks you through making a small gadget with a screen or a strip of lights: a timer, a little
            dashboard, a lamp that reacts to the room. You start with an example running in your browser, make it
            your own, put it on a real board and change the parts around it. You don't need to know electronics or
            programming. Claude writes the code; you decide what it should do and check that it does.
          </p>

          <div className="guide-need">
            <h3>What you need</h3>
            <ul>
              <li>
                <strong>To start:</strong> a computer and a browser. Chrome or Edge is best: watching a folder for apps
                (step 2) only works there.
              </li>
              <li>
                <strong>From step 2:</strong>{' '}
                <Out href="https://claude.com/claude-code">Claude Code</Out>, Anthropic's coding assistant, which runs in
                your terminal. It writes the apps and, later, the software for your board.
              </li>
              <li>
                <strong>From step 3:</strong> a board and a USB cable that carries data (some only charge). Steps 1, 2 and
                4 work without one, so you can decide what to buy after trying it.
              </li>
            </ul>
          </div>

          <section className="guide-step" id="pieces" aria-labelledby="pieces-title">
            <h2 id="pieces-title">The pieces, in plain words</h2>
            <dl className="guide-terms">
              <dt>Board</dt>
              <dd>
                A small computer, an <em>ESP32</em>, about the size of a stick of gum. It runs your app and joins your Wi-Fi.
                Some boards come with a screen built in; others drive a separate display or a chain of LEDs over a few wires.
              </dd>
              <dt>Output</dt>
              <dd>What your app shows things on: a display (LCD, OLED, AMOLED or e-paper) or a strip, ring or grid of colour LEDs.</dd>
              <dt>Inputs</dt>
              <dd>
                The parts you touch, or that sense the room: buttons, a knob (a <em>rotary encoder</em>), a slider (a{' '}
                <em>slide pot</em>), sensors for motion, light, temperature or someone standing nearby, and a buzzer that
                beeps.
              </dd>
              <dt>App</dt>
              <dd>
                One short file of code in a language called Lua, ending in <code>.lua</code>. It draws on the output and
                reacts to the inputs. You can read it, but you don't have to write it.
              </dd>
              <dt>Resident</dt>
              <dd>
                The software on the board that receives apps over the internet and runs them, made by{' '}
                <Out href="https://inanimate.tech">Inanimate</Out>. Because of it you never have to re-flash the board to
                change the app: you send a new one and it starts in a second. Bench runs the same Resident in your browser.
              </dd>
              <dt>Relay and device ID</dt>
              <dd>
                The relay is Resident's server: it carries apps from you to a board. Each board (and each Bench) has a
                device ID, a short code that is its address there. Anyone who knows the ID can send it apps, so treat it
                like a password.
              </dd>
              <dt>Firmware</dt>
              <dd>
                What's installed on the board itself, Resident included. You put it on once, over USB (that's
                <em> flashing</em>). After that, apps arrive over Wi-Fi.
              </dd>
              <dt>Bench</dt>
              <dd>
                This site. A desk in your browser with the board, the output and the inputs simulated at the real
                hardware's speed, so you can try an idea and the parts it needs before you own any of them.
              </dd>
            </dl>

            <figure className="guide-flow" aria-label="How an app travels: Claude Code writes it, Bench runs it, your board runs it for real">
              <div className="guide-box">
                <strong>Claude Code</strong>
                <span>writes the app from what you ask for</span>
              </div>
              <div className="guide-arrow">
                <span>saves a .lua file, or pushes it over the relay</span>
              </div>
              <div className="guide-box">
                <strong>Bench</strong>
                <span>runs it on the simulated output, with your virtual parts</span>
              </div>
              <div className="guide-arrow">
                <span>mirrors it over the relay</span>
              </div>
              <div className="guide-box">
                <strong>Your board</strong>
                <span>runs the same app on the real screen or LEDs</span>
              </div>
            </figure>
          </section>

          <Step n={1}>
            <p>
              <a href="/">Open Bench</a>. It starts on an example called <Ui>Porous systems</Ui>: a logo drawing itself on a
              small screen, sitting on a desk next to a knob, a slider and a button. The page has three columns:
            </p>
            <ul>
              <li>
                <strong>Left, the app:</strong> which app runs (<Ui>App</Ui>), its code (<Ui>Code</Ui>), the ways apps
                arrive from outside, and the <Ui>Console</Ui>, where the app's messages and errors appear.
              </li>
              <li>
                <strong>Middle, the desk:</strong> the device and its parts. <Ui>3D</Ui>, <Ui>Flat</Ui> and <Ui>Wiring</Ui>{' '}
                above it switch between a 3D model, the bare screen pixel for pixel, and a wiring diagram.
              </li>
              <li>
                <strong>Right, the hardware:</strong> the <Ui>Output</Ui> the app draws on, the <Ui>Inputs</Ui> on the
                desk, and the <Ui>Connections</Ui> between them.
              </li>
            </ul>
            <p>Now play with it:</p>
            <ol>
              <li>
                Turn the knob: drag its ring on the desk, or press <Key>←</Key> and <Key>→</Key>. The hollow spoke in the
                logo moves round.
              </li>
              <li>Click the button on the desk (Button 1). It stamps a spoke where the hollow one is.</li>
              <li>Drag the slider. The background runs from black through the colours to white.</li>
              <li>
                Press <Key>A</Key> to start the logo again.
              </li>
            </ol>
            <p>
              Then open the <Ui>App</Ui> menu and try a few others: <Ui>Hello display</Ui> shows facts about the screen and
              a bouncing ball, <Ui>Knob menu</Ui> is a settings menu you drive with the knob. The menu lists only the apps
              that can run on this output; the rest are greyed out at the bottom, each with the reason.
            </p>

            <h3>Change something</h3>
            <p>
              The <Ui>Code</Ui> panel shows the app's code. You don't need to understand it to change it. In{' '}
              <Ui>Hello display</Ui>, look for a number or a colour (colours look like <code>0xFF8800</code>: red, green and
              blue as two characters each), change it, and press <Ui>Run ⌘↵</Ui> (or <Key>⌘</Key> <Key>Enter</Key>,{' '}
              <Key>Ctrl</Key> <Key>Enter</Key> on Windows). The app restarts with your change.
            </p>
            <p>
              If you break it, the screen stops and the <Ui>Console</Ui> says what went wrong and on which line. Pick the
              app again from the <Ui>App</Ui> menu to get the original back.
            </p>
            <Check>
              your change on the screen, and "Hello display (edited)" in the <Ui>App</Ui> menu.
            </Check>
            <p className="guide-aside">
              Along the top, <Ui>↻ Restart</Ui> starts the app from the beginning and <Ui>❚❚ Pause</Ui> freezes time, with{' '}
              <Ui>Step</Ui> to move a frame at a time. Everything you set up is saved in this browser and is there next time.
            </p>
          </Step>

          <Step n={2}>
            <p>
              Examples are for learning. For your own idea, describe it to Claude and let it write the app. Bench copies
              Claude everything it needs to know: the output, the parts on your desk, how Resident apps work and how to send
              the result back. There are two ways for the app to reach Bench; start with the first.
            </p>

            <h3>Set up Claude Code once</h3>
            <ol>
              <li>
                Install <Out href="https://claude.com/claude-code">Claude Code</Out> and start it in a terminal with{' '}
                <code>claude</code>.
              </li>
              <li>
                Add Resident's plugin, which teaches Claude how Resident apps work. Type these into Claude Code:
                <pre>
                  <code>{'/plugin marketplace add inanimate-tech/agent-plugins\n/plugin install resident@inanimate'}</code>
                </pre>
              </li>
            </ol>

            <h3>The simple way: a folder Bench watches</h3>
            <ol>
              <li>
                Make a new, empty folder for your project, for example <code>my-device</code> in your Documents.
              </li>
              <li>
                In Bench, under <Ui>Receive apps</Ui>, press <Ui>Watch a folder for apps</Ui> and pick that folder. The browser
                asks whether Bench may edit it: say yes, so Bench can put a file there that tells Claude about this Bench (
                <code>DEVICE-SKILL.md</code>).
              </li>
              <li>
                Open a terminal in the same folder and start <code>claude</code>.
              </li>
              <li>
                In Bench's <Ui>App</Ui> panel, press <Ui>Copy a prompt for Claude</Ui>, paste it into Claude Code and add a
                sentence or two about your idea. Be concrete about what each part should do:
                <blockquote>
                  A kitchen timer. Turning the knob sets the minutes, the button starts and pauses it, and when it reaches
                  zero the screen flashes.
                </blockquote>
              </li>
              <li>Claude writes the app and saves it in the folder. Bench runs it the moment it's saved.</li>
            </ol>
            <Check>
              the new app on Bench's screen, and "Running …" with its file name under <Ui>Receive apps</Ui>.
            </Check>
            <p>
              Now keep talking to Claude: "make the numbers bigger", "count down in seconds for the last minute", "it
              crashes when I turn the knob below zero". Each time it saves, Bench runs the new version. When something's
              wrong, tell Claude what you see, and paste what the <Ui>Console</Ui> says.
            </p>
            <p>
              After a reload, the browser asks again before Bench can read the folder: press{' '}
              <span className="ui">Resume watching …</span> under <Ui>Receive apps</Ui>.
            </p>

            <h3>The other way: over the relay</h3>
            <p>
              Bench can also join Resident's relay and receive apps exactly as a real board does. Under{' '}
              <Ui>Receive apps</Ui>, press <Ui>Connect</Ui>; when it says online, <Ui>Copy push-app</Ui> copies a command with
              this Bench's device ID. Paste it into Claude Code and follow it with your idea. Use this when you work from
              another computer, or want to see the exact path an app takes to a board. Claude Code may ask before sending a
              file to an outside server; the folder needs no such permission.
            </p>

            <h3>Or start from the parts yourself</h3>
            <p>
              <Ui>Start from my bench</Ui>, also under <Ui>App</Ui>, writes an app with every part on your desk already
              connected and shown live on the screen. It's a skeleton: useful if you'd like to edit code yourself, or to
              check that each part does what you expect.
            </p>
          </Step>

          <Step n={3}>
            <p>
              When the app does what you want on Bench, put it on real hardware. This happens once per board: install
              Resident on it, connect it to your Wi-Fi, and from then on Bench can send it any app.
            </p>

            <h3>Choose a board</h3>
            <p>
              The easiest are the boards that already have firmware tested on them (Bench's own, or Resident's for the
              M5Sticks). Each has its screen built in or comes as a pair, so there is nothing to wire:
            </p>
            <ul>
              <li>Waveshare ESP32-C6-LCD-1.47 (a narrow colour screen)</li>
              <li>Waveshare ESP32-S3-Touch-LCD-2 (a 2″ colour touch screen, with a motion sensor)</li>
              <li>Waveshare 2.13″ e-Paper on the Waveshare ESP32 e-Paper Driver Board (black and white, readable in daylight, slow to change)</li>
              <li>M5StickC Plus2 or M5StickS3 (a small screen in a case, with buttons)</li>
            </ul>
            <p>
              Any other display or LED strip in Bench works too: Claude builds firmware for it step by step, checking each
              stage with you on the real board. That takes longer and some back and forth, so it's a good second project.
            </p>

            <h3>Install Resident on it</h3>
            <ol>
              <li>
                In Bench's <Ui>Output</Ui>, choose the display you have (and, for a bare display or LEDs, the board under it).
              </li>
              <li>
                Under <Ui>Real device</Ui>, press <Ui>Copy a prompt to set up a board</Ui>.
              </li>
              <li>
                Make another empty folder, start <code>claude</code> in it and paste the prompt. Claude installs PlatformIO
                (the tool that builds and flashes ESP32 software) if you don't have it, and builds the firmware.
              </li>
              <li>
                Plug the board in. Claude finds it and asks you to confirm before flashing, because flashing replaces
                whatever was on it. If the board doesn't show up, try another cable, or hold its BOOT button while you plug
                it in.
              </li>
            </ol>

            <h3>Get it online</h3>
            <ol>
              <li>
                After flashing, the board opens a Wi-Fi network of its own, named "Resident …". Join it from your phone; a
                page opens where you pick your home Wi-Fi and type its password. ESP32 boards only use 2.4 GHz Wi-Fi.
              </li>
              <li>The board joins your Wi-Fi, connects to the relay and shows its device ID on the screen (Claude reads it out too).</li>
              <li>
                In Bench, under <Ui>Real device</Ui>, type the ID and press <Ui>Mirror</Ui>.
              </li>
            </ol>
            <Check>
              "mirroring" next to <Ui>Real device</Ui>, and your app on the board a moment later. Turn the knob in Bench and the
              real screen follows.
            </Check>
            <p>
              That's <em>mirroring</em>: the board runs the app itself, and Bench feeds it the inputs. So you don't need any
              real knobs or sensors yet: the ones on Bench's desk drive the board. While Bench mirrors, the board's own
              buttons are ignored and <Key>A</Key> and <Key>B</Key> come from Bench, so both screens always agree. Pick
              another app in Bench and the board switches to it.
            </p>
            <p>
              <Ui>Stop</Ui> ends mirroring; the board keeps running the app with the last values it got. Next time, the board
              is in a menu under <Ui>Real device</Ui>, so you don't have to type its ID again.
            </p>
          </Step>

          <Step n={4}>
            <p>
              Designing is mostly trying things: a bigger screen, a second button, a sensor instead of a knob. On Bench each
              of those is a click, and you can see whether the app still makes sense before buying anything.
            </p>

            <h3>The output</h3>
            <p>
              In <Ui>Output</Ui>, the first menu chooses a display, an <Ui>LED strip</Ui>, an <Ui>LED ring</Ui> or an{' '}
              <Ui>LED matrix</Ui>; the next one which display, or how many LEDs. For a bare display or LEDs, a third menu
              picks the board that drives it. Under them, Bench lists what that board can run: its drawing libraries and how
              much memory an app gets. The <Ui>App</Ui> menu then shows only the apps that fit.
            </p>
            <p>
              An app written for one screen often runs on another, but a layout made for a wide screen may not fit a narrow
              one. Switch, look, and ask Claude to adapt it ("make it work on the 128×64 OLED too").
            </p>

            <h3>The inputs</h3>
            <p>
              In <Ui>Inputs</Ui>, <Ui>+ Add an input…</Ui> puts a part on the desk: a push button, a rotary encoder, a slide
              pot, a touch pad, an IMU (senses tilt and shaking), an LD2410 radar (senses someone standing still nearby), a
              PIR (senses movement), a light sensor, a temperature and humidity sensor, or a buzzer. Each one gets a control in
              the panel and a model on the desk, wired to the board. <Ui>remove</Ui> takes one away. Parts marked{' '}
              <Ui>built-in</Ui> are part of the board itself.
            </p>

            <h3>The connections</h3>
            <p>
              An app doesn't ask for "the encoder on pin 4". It asks for what it needs: a <em>dial</em> called "minutes" (a
              value to turn up and down) or a <em>trigger</em> called "start" (something that happens). <Ui>Connections</Ui>{' '}
              lists them, and for each one you choose which part drives it:
            </p>
            <table className="guide-table">
              <thead>
                <tr>
                  <th>The app asks for</th>
                  <th>Any of these can drive it</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>a dial: a number in a range</td>
                  <td>turning an encoder, a slide pot, tilting the IMU, the radar's distance, light level, temperature, humidity</td>
                </tr>
                <tr>
                  <td>a trigger: a moment</td>
                  <td>a button press, pushing the encoder, a touch, shaking the IMU, the radar seeing someone, PIR motion, the room going dark</td>
                </tr>
              </tbody>
            </table>
            <p>
              So the kitchen timer's "minutes" could be the knob today and a tilt of the device tomorrow, with no change to
              the code. If the part you want isn't on the desk, the same menu offers to add it. <Ui>Keyboard only</Ui> leaves a
              control on its keys. Bench remembers your choice for each app.
            </p>
            <p>
              When a new part should do something new ("dim the screen when the room gets dark"), press{' '}
              <Ui>Copy a prompt for Claude</Ui> again so Claude sees the new desk, or just tell it what you added.
            </p>
            <Check>
              the value next to each dial in <Ui>Connections</Ui> change as you move its part. If you're mirroring, the real
              board reacts to the new parts as well.
            </Check>
          </Step>

          <Step n={5}>
            <p>
              Mirroring needs Bench open. For a device that works on its own, wire the real parts to the board and have them
              read by its firmware.
            </p>
            <ol>
              <li>
                Press <Ui>Wiring</Ui> above the desk. Bench draws the board, the power rails and each part, with every wire
                labelled at both ends: which pin on the part goes to which pin on the board. Under the diagram is a list of
                what to check before you power up. <Ui>Save diagram</Ui> downloads it to print.
              </li>
              <li>
                Unplug the board, then wire it as drawn, with jumper wires and a breadboard. Before plugging it back in,
                compare the pins with your board's own pinout: Bench's pins come from datasheets and can be wrong.
              </li>
              <li>
                Press <Ui>Copy a prompt to set up a board</Ui> again. It now lists your parts and their pins. Paste it into
                Claude Code and say that you want the real parts to work on their own; Claude adds them to the firmware and
                flashes it again.
              </li>
            </ol>
            <p className="guide-aside">
              Unplug before changing any wire. Power each part from the pin the diagram shows (3V3 or 5V), and never join a
              power pin straight to GND: either can damage the board.
            </p>
          </Step>

          <Step n={6}>
            <ul>
              <li>
                <strong>Your setup is saved</strong> in this browser: the output, the parts, the connections and the app.
              </li>
              <li>
                <strong>Your app is a file</strong> in the folder Claude saved it in. Keep that folder; it's your project.
                Bench can run it again any time (<Ui>Open .lua…</Ui> under <Ui>Code</Ui>, or drop the file on the screen).
              </li>
              <li>
                <Ui>Share</Ui>, at the top of Bench, copies a link that opens your whole setup, app included, in anyone's
                Bench. Good for showing someone, or for asking for help. Anyone with the link can see the app.
              </li>
            </ul>
          </Step>

          <section className="guide-step" id="stuck" aria-labelledby="stuck-title">
            <h2 id="stuck-title">When something's wrong</h2>
            <dl className="guide-terms">
              <dt>The app isn't in the menu</dt>
              <dd>It's greyed out at the bottom of the menu, with why: usually the screen is too small, or the board lacks a library or memory it needs.</dd>
              <dt>"execution deadline exceeded"</dt>
              <dd>Part of the app took over a second. A real board stops it at the same point, so ask Claude to make that part lighter.</dd>
              <dt>The board doesn't show up when flashing</dt>
              <dd>Try another USB cable (many only charge), then hold BOOT while plugging it in.</dd>
              <dt>The board never comes online</dt>
              <dd>Check it joined a 2.4 GHz network and that the password was right. Claude can watch what it prints over USB and tell you where it stops.</dd>
              <dt>Mirror says the device is offline</dt>
              <dd>The board isn't connected to the relay: check its screen, and that the ID matches exactly.</dd>
            </dl>
            <p>
              Still stuck? Write to <a href="mailto:bench@porous.systems">bench@porous.systems</a>, with a <Ui>Share</Ui> link if
              it's about an app.
            </p>
          </section>

          <footer className="guide-foot">
            <p>
              Bench is open source:{' '}
              <Out href="https://github.com/sjunnesson/porous-bench">porous-bench on GitHub</Out>. The apps it runs are{' '}
              <Out href="https://github.com/inanimate-tech/resident">Resident</Out> apps, by Inanimate.
            </p>
            <a className="guide-open" href="/">
              Open Bench
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}
