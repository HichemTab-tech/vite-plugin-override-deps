import * as React from 'react';
import {useEffect} from "react";
//import {GiveHichemTabTechCredit, MyComponent} from '../dist/main.js'; // Import your built library

const App = () => {

    useEffect(() => {
        console.log("useEffect");
    }, []);

    return (
        <div>
            <h1 className="text-red-600">Override deps at runtime Demo</h1>
        </div>
    );
};

export default App;
