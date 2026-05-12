import { $state, F } from "effectual";

import styles from "../../styles/test.scss";

export const App = () => {
    const count = $state(0);
    const numTabs = $state(2);

    return (
        <div style={{ width: "100%", height: "100%" }} data-stylesheet={styles}>
            <div class="modal-root">
                <div class="modal-content">
                    <div class="tabs">
                        {new Array(numTabs.getValue()).fill(0).map((_, i) => (
                            <div class="tab tabn" key={`tab-${i}`}>
                                Tab {i + 1}
                            </div>
                        ))}

                        <button
                            class="tab"
                            $on:mousedown={() => {
                                numTabs.set((i) => i + 1);
                            }}
                        >
                            +
                        </button>
                    </div>
                    <div class="click-me" $on:mouseup={() => count.set((i) => i + 1)}>
                        <div>Hello World</div>
                        <div>Click Me{"!".repeat(count.value + 1)}</div>
                    </div>
                    <button>-Zach</button>
                </div>
            </div>
        </div>
    );
};
