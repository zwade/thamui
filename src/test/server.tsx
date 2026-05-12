import { F } from "effectual";
import fs from "node:fs/promises";
import ssh2 from "ssh2";

import { mount, StdinPtyLike, StdoutPtyLike } from "../effectual-bindings/reconciler.js";
import { App } from "./app.js";

export const startServer = async (port: number) => {
    const privateKey = await fs.readFile(new URL("../../server_id_rsa", import.meta.url).pathname);

    const server = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
        client.on("authentication", (ctx) => {
            ctx.accept();
        });

        client.on("ready", () => {
            client.on("session", (accept, reject) => {
                const session = accept();
                let columns = 80;
                let rows = 24;
                const resizeListeners = new Set<() => void>();

                session.on("pty", (accept, reject, info) => {
                    columns = info.cols;
                    rows = info.rows;
                    accept();
                });

                session.on("window-change", (accept, reject, info) => {
                    columns = info.cols;
                    rows = info.rows;
                    resizeListeners.forEach((listener) => listener());
                    accept();
                });

                session.on("shell", (accept, reject) => {
                    const stream = accept();
                    const stdin: StdinPtyLike = {
                        setRawMode: (mode: boolean) => {
                            if (mode) {
                                stream.write("\x1b[?1000h"); // Enable mouse tracking
                            } else {
                                stream.write("\x1b[?1000l"); // Disable mouse tracking
                            }
                        },
                        on: (event: "data", listener: (data: Buffer) => void) => {
                            stream.on("data", listener);
                        },
                    };

                    const stdout: StdoutPtyLike = {
                        get columns() {
                            return columns;
                        },
                        get rows() {
                            return rows;
                        },
                        write: (data: any) => {
                            stream.write(data);
                        },
                        on: (event: "resize", listener: () => void) => {
                            if (event === "resize") {
                                resizeListeners.add(listener);
                            }
                        },
                    };

                    mount(App, { stdout: stdout, stdin: stdin, stderr: stream.stderr });
                });
            });
        });
    });

    server.listen(port, "0.0.0.0");
};

await startServer(6022);
