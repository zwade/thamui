import { $state, F } from "effectual";

import loginStyles from "../../styles/test-stylesheet.scss";

export const App = () => {
    const username = $state("");
    const password = $state("");
    const status = $state("");

    const submit = () => {
        if (username.getValue().length === 0 || password.getValue().length === 0) {
            status.setValue("Please fill in both fields.");
            return;
        }

        status.setValue(`Welcome, ${username.getValue()}.`);
    };

    return (
        <div data-stylesheet={loginStyles} class="page">
            <div class="login-card">
                <div class="title">Sign in</div>
                <div class="subtitle">Thamui Portal</div>

                <div class="field">
                    <div class="label">Username</div>
                    <input class="input" value={username.getValue()} $on:change={(v: string) => username.setValue(v)} />
                </div>

                <div class="field">
                    <div class="label">Password</div>
                    <input
                        class="input"
                        type="password"
                        value={password.getValue()}
                        $on:change={(v: string) => password.setValue(v)}
                    />
                </div>

                <div class="actions">
                    <button class="ghost">Sign up</button>
                    <button class="submit" $on:mouseup={submit}>
                        Sign in
                    </button>
                </div>

                <div class="status">{status.getValue()}</div>
            </div>
        </div>
    );
};
