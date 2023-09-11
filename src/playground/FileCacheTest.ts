import {FileCache, CacheRecord} from "../util/FileCache";

let  app = async () => {

    let fileCache : FileCache = FileCache.create(process.cwd() + "/test.txt");
    let ids = new Array<number>();

    for(let i = 0; i < 1000; i++) {
        let record = await fileCache.write(Buffer.from("hello world" + i));
        ids.push(record.id);
        if(i % 100 == 0 && i != 0) {
            fileCache.remove(record.id);

        }
    }

    for(let id of ids) {
        let record = await fileCache.read(id);
        console.log(record?.toString());
    }




}


app().then()