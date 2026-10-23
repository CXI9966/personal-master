import { weekdayName } from '../../../shared/calendar'
import { FEATURE_NAMES, FEATURES } from '../../../shared/usageText'
import { useSnapshot } from '../hooks/useSnapshot'
import { ErrorNote } from './Notices'
import BarChart from './viz/BarChart'

const n = (value: number): string => value.toLocaleString('zh-CN')

/** 本周管家用了多少 token，按功能、按天 */
export default function UsagePanel() {
  const { data, error } = useSnapshot('ai:usage')
  if (error) return <ErrorNote message={error} />
  if (!data) return <p className="hint">加载中…</p>

  if (data.total.calls === 0) return <p className="hint">本周（{data.weekStart} ~ {data.weekEnd}）还没有调用过管家。</p>

  return (
    <div>
      <p>
        本周（{data.weekStart} ~ {data.weekEnd}）调用 {data.total.calls} 次，输入 {n(data.total.inputTokens)} token，输出 {n(data.total.outputTokens)} token。
      </p>
      {data.callsWithoutTokens > 0 && <p className="hint">有 {data.callsWithoutTokens} 次调用接口没有返回 token 数，只算了次数。</p>}
      <BarChart
        label="本周每天调用管家的次数"
        unit=" 次"
        items={data.byDay.map((day) => ({ label: weekdayName(day.date), value: day.calls, hint: `${day.date} ${weekdayName(day.date)}：调用 ${day.calls} 次` }))}
      />
      <table>
        <caption className="sr-only">本周管家用量，按功能</caption>
        <thead>
          <tr>
            <th scope="col">功能</th>
            <th scope="col">次数</th>
            <th scope="col">输入 token</th>
            <th scope="col">输出 token</th>
          </tr>
        </thead>
        <tbody>
          {FEATURES.flatMap((feature) => {
            const t = data.byFeature[feature]
            return t ? [<tr key={feature}><td>{FEATURE_NAMES[feature]}</td><td>{t.calls}</td><td>{n(t.inputTokens)}</td><td>{n(t.outputTokens)}</td></tr>] : []
          })}
        </tbody>
      </table>
      <table>
        <caption className="sr-only">本周管家用量，按天</caption>
        <thead>
          <tr>
            <th scope="col">日期</th>
            <th scope="col">次数</th>
            <th scope="col">输入 token</th>
            <th scope="col">输出 token</th>
          </tr>
        </thead>
        <tbody>
          {data.byDay.map((day) => (
            <tr key={day.date}>
              <td>{`${day.date.slice(5)} ${weekdayName(day.date)}`}</td>
              <td>{day.calls || ''}</td>
              <td>{day.calls ? n(day.inputTokens) : ''}</td>
              <td>{day.calls ? n(day.outputTokens) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
