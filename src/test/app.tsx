import { $state, F } from "effectual";

import testStyles from "../../styles/test-stylesheet.scss";

export const App = () => {
    const message = $state("hi");

    return (
        <div data-stylesheet={testStyles} style={{ width: "100%", height: "100%" }}>
            <div class="root">
                <button class="btn">First</button>
                <button class="btn">Second</button>
                <input class="input" value={message.getValue()} $on:change={(e) => message.setValue(e)} />
                {message.getValue()}
            </div>
        </div>
    );
};
