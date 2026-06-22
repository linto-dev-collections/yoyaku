/** emmett 流の Decider。decide=ビジネス判断（純粋）、evolve=状態畳み込み、initialState=初期状態。 */
export type Decider<Command, State, Event> = {
  initialState: () => State;
  decide: (command: Command, state: State) => Event[];
  evolve: (state: State, event: Event) => State;
};

/** イベント列から現在状態を復元（リプレイ）。 */
export function replay<State, Event>(
  decider: Pick<Decider<unknown, State, Event>, "initialState" | "evolve">,
  events: Event[],
): State {
  return events.reduce(decider.evolve, decider.initialState());
}
