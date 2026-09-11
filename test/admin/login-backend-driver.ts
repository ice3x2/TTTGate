import AdminServer from "../../src/server/admin/AdminServer";
import ServerOptionStore from "../../src/server/ServerOptionStore";
import {IdentityMigration} from "../../src/server/rbac/IdentityMigration";
import {applyTestRoot} from "../helpers/runtime";

applyTestRoot(process.argv[2]);
ServerOptionStore.instance;
(async () => {
    await IdentityMigration.runAtStartup();
    const api = new AdminServer({} as any, false);
    api.listen(0, "127.0.0.1").then((port) => process.send?.({port, pid: process.pid}));
    process.on("message", async (message) => {
        if(message === "close") {
            await api.close();
            process.disconnect?.();
        }
    });
})();
