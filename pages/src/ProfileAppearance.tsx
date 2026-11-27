import type { CSSProperties } from 'react'

const constellations = {
  Aries: ['♈', '#5c2934', '#f3c5a3', [[5, 73], [32, 24], [71, 48], [94, 84]]],
  Taurus: ['♉', '#34462d', '#d3dc9b', [[4, 21], [36, 77], [59, 54], [92, 9], [59, 54], [96, 72]]],
  Gemini: ['♊', '#554027', '#f4d886', [[13, 12], [44, 34], [68, 90], [44, 34], [74, 26], [88, 3], [74, 26], [96, 68]]],
  Cancer: ['♋', '#2d4e55', '#b6efe6', [[13, 83], [51, 47], [46, 8], [51, 47], [91, 68]]],
  Leo: ['♌', '#624026', '#ffd582', [[6, 82], [33, 54], [78, 68], [92, 38], [78, 12], [58, 19], [52, 47], [78, 68], [52, 94], [33, 54]]],
  Virgo: ['♍', '#49503c', '#e3da9d', [[7, 13], [29, 39], [53, 35], [88, 5], [53, 35], [59, 60], [92, 78], [59, 60], [44, 90], [25, 71], [29, 39]]],
  Libra: ['♎', '#49355f', '#f3d1ff', [[19, 92], [33, 51], [57, 12], [85, 31], [74, 57], [33, 51], [74, 57], [93, 85]]],
  Scorpio: ['♏', '#5c2c4f', '#f7b5c8', [[13, 3], [30, 37], [37, 69], [60, 91], [82, 82], [95, 52], [79, 32], [95, 52], [97, 23]]],
  Sagittarius: ['♐', '#3f3e72', '#d2c9ff', [[5, 68], [30, 43], [55, 43], [47, 14], [30, 43], [37, 80], [68, 84], [94, 65], [78, 46], [55, 43], [68, 84]]],
  Capricorn: ['♑', '#2a4d55', '#a6e9e6', [[5, 20], [26, 53], [57, 94], [80, 55], [96, 24], [65, 41], [35, 35], [5, 20]]],
  Aquarius: ['♒', '#254b61', '#a1ddf5', [[8, 15], [33, 29], [48, 48], [75, 19], [96, 39], [75, 19], [48, 48], [66, 70], [43, 91], [25, 72]]],
  Pisces: ['♓', '#354663', '#c0cfff', [[7, 13], [19, 43], [38, 63], [57, 94], [75, 69], [87, 33], [96, 15], [77, 13], [87, 33]]],
  Ophiuchus: ['⛎', '#374d43', '#c9f0c3', [[6, 67], [29, 45], [43, 9], [66, 36], [95, 63], [66, 36], [77, 91], [48, 69], [25, 87], [29, 45]]],
} satisfies Record<string, [string, string, string, number[][]]>

export type Constellation = keyof typeof constellations
export const constellationOptions = Object.keys(constellations) as Constellation[]

function colors(sign: Constellation): CSSProperties {
  const [, background, accent] = constellations[sign]
  return { '--constellation-background': background, '--constellation-accent': accent } as CSSProperties
}

export function ConstellationAvatar({ sign }: { sign: Constellation }) {
  return <span className="constellation-avatar" style={colors(sign)} aria-hidden="true">{constellations[sign][0]}︎</span>
}

export function ProfileAppearance({ sign, choose, name }: { sign: Constellation; choose: (sign: Constellation) => void; name: string }) {
  const [, , , stars] = constellations[sign]
  return <section className="preferences-card profile-card" aria-labelledby="profile-heading">
    <h2 id="profile-heading">Profile</h2>
    <div className="profile-banner" style={colors(sign)}>
      <div className="profile-star-map" role="img" aria-label={sign + ' constellation banner'}>
        {stars.slice(1).map(([x, y], index) => {
          const [fromX, fromY] = stars[index]
          return <i key={index} style={{ left: fromX, top: fromY, width: Math.hypot(x - fromX, y - fromY), transform: `rotate(${Math.atan2(y - fromY, x - fromX)}rad)` }} />
        })}
        {stars.map(([x, y], index) => <b key={index} style={{ left: x, top: y }} />)}
      </div>
      <div className="profile-identity"><ConstellationAvatar sign={sign} /><div><strong>{name}</strong><span>{sign}</span></div></div>
    </div>
    <fieldset className="constellation-picker">
      <legend>Choose a constellation</legend>
      <p>Each constellation comes with a matching avatar and banner.</p>
      <div className="constellation-options">
        {constellationOptions.map(option => <label key={option}>
          <input type="radio" name="constellation" checked={sign === option} onChange={() => choose(option)} />
          <span className="constellation-choice"><ConstellationAvatar sign={option} /><span>{option}</span></span>
        </label>)}
      </div>
    </fieldset>
  </section>
}
