import ssh2 from "ssh2";
import fs from "node:fs/promises";
import { GameManager } from "./game.js";
import { testMap } from "./test.js";

export const startServer = async (port: number) => {
    const privateKey = await fs.readFile(new URL("../server_id_rsa", import.meta.url).pathname);

    const server = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
        client.on("authentication", (ctx) => {
            ctx.accept();
        });

        client.on("ready", () => {
            client.on("session", (accept, reject) => {
                const session = accept();

                session.on("pty", (accept) => {
                    accept();
                });

                session.on("shell", (accept, reject) => {
                    const stream = accept();
                    const game = new GameManager(10, 10, testMap(), { stdout: stream, stdin: stream });
                    game.runGame().then(() => {
                        stream.end();
                    });
                });
            })
        })
    })

    server.listen(port, "0.0.0.0");
}

await startServer(6022);