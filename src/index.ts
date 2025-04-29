import { GameManager } from "./game.js";
import { testMap } from "./test.js";
import rl from "node:readline";

rl.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
}


const gameMap = new GameManager(10, 10, testMap());

gameMap.runGame().then(() => process.exit(0));

process.stdin.setRawMode(false);